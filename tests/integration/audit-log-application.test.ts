/**
 * Covers issue #10 (audit-log every write with employee and Company) at the
 * HTTP application seam, the same level as
 * company-authorization-application.test.ts: the real HTTP server, routing,
 * and the audit-log chokepoint in ../../src/helpers/register-tool.ts all run
 * for real. A fake AuditLogger is injected the same way `companyAuth` is
 * injected in that suite - no real Firestore needed.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuditLogEntry, AuditLogger } from '../../src/audit/audit-log';

const { createStreamableHttpServer, MCP_HTTP_PATH } = await import('../../src/http/create-streamable-http-server');
const { RegisterTool } = await import('../../src/helpers/register-tool');
const { OAuthStore } = await import('../../src/auth/oauth-store');
const { CompanyAuthorizationStore } = await import('../../src/auth/company-authorization');
const { FirestoreGrantStore } = await import('../../src/clients/firestore-grant-store');
const { InMemoryFirestore } = await import('../../src/clients/in-memory-firestore');

const EMPLOYEE = { sub: 'intuit-sub-a', email: 'a@example.com' };
const TOKEN = 'bearer-token-a';

class RecordingAuditLog implements AuditLogger {
  entries: AuditLogEntry[] = [];
  shouldFail = false;

  async record(entry: AuditLogEntry): Promise<void> {
    if (this.shouldFail) throw new Error('audit store unavailable');
    this.entries.push(entry);
  }
}

// A minimal write tool, taking one business parameter beyond the realm_id
// register-tool.ts injects on every write. Fails when told to, so the
// "writes that fail are logged too" criterion can be exercised without a
// real QuickBooks handler.
function registerTestTools(server: McpServer): void {
  RegisterTool(server, {
    name: 'create_echo',
    description: 'Test-only write tool',
    schema: z.object({ note: z.string(), fail: z.boolean().optional() }),
    handler: async ({ params }: any) => {
      if (params?.fail) throw new Error('QuickBooks rejected the write');
      return { content: [{ type: 'text' as const, text: `created: ${params.note}` }] };
    },
  } as any);
  RegisterTool(server, {
    name: 'get_echo',
    description: 'Test-only read tool',
    schema: z.object({}),
    handler: async () => ({ content: [{ type: 'text' as const, text: 'read-only' }] }),
  } as any);
}

async function listen(server: http.Server): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}`);
}

describe('write audit trail application (#10)', () => {
  let server: http.Server;
  let base: URL;
  let audit: RecordingAuditLog;

  beforeEach(async () => {
    audit = new RecordingAuditLog();
    const grantStore = new FirestoreGrantStore(new InMemoryFirestore());
    await grantStore.forGrant({ employeeSub: EMPLOYEE.sub, realmId: 'company-a' }).create('refresh-token');

    const oauthStore = new OAuthStore();
    (oauthStore as unknown as { resolveAccessToken: (token: string) => { sub: string; email: string } | undefined }).resolveAccessToken = (
      token: string
    ) => (token === TOKEN ? EMPLOYEE : undefined);

    server = createStreamableHttpServer(registerTestTools, {
      oauth: {
        store: oauthStore,
        identityProvider: {
          authorizationUrl: () => {
            throw new Error('not used in this suite');
          },
          exchangeCodeForIdentity: async () => {
            throw new Error('not used in this suite');
          },
        },
        loadConfig: () => {
          throw new Error('not used in this suite');
        },
      },
      companyAuth: {
        grantStore,
        pending: new CompanyAuthorizationStore(),
        authorizationProvider: {
          authorizationUrl: () => {
            throw new Error('not used in this suite');
          },
          exchangeCodeForGrant: async () => {
            throw new Error('not used in this suite');
          },
        } as any,
        companyInfoProvider: { fetchCompanyName: async () => 'Company A' } as any,
      },
      audit,
    });
    base = await listen(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function callTool(name: string, params: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_HTTP_PATH, base), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name, arguments: { params } });
      const content = result.content as Array<{ type: string; text: string }>;
      return { isError: Boolean(result.isError), text: content[0]?.text ?? '' };
    } finally {
      await client.close();
    }
  }

  it('logs employee identity, realm id, tool name and params before a write executes', async () => {
    const { text } = await callTool('create_echo', { note: 'hello', realm_id: 'company-a' });
    expect(text).toBe('created: hello');

    expect(audit.entries).toEqual([
      {
        employeeSub: EMPLOYEE.sub,
        employeeEmail: EMPLOYEE.email,
        realmId: 'company-a',
        toolName: 'create_echo',
        params: { note: 'hello' },
      },
    ]);
  });

  it('logs a write that goes on to fail, the same as one that succeeds', async () => {
    const { isError, text } = await callTool('create_echo', { note: 'boom', fail: true, realm_id: 'company-a' });
    expect(isError).toBe(true);
    expect(text).toContain('QuickBooks rejected the write');

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ toolName: 'create_echo', realmId: 'company-a' });
  });

  it('never logs a read', async () => {
    await callTool('get_echo', {});
    expect(audit.entries).toHaveLength(0);
  });

  it('never blocks or alters a write when the audit store itself is down', async () => {
    audit.shouldFail = true;
    const { text } = await callTool('create_echo', { note: 'hello', realm_id: 'company-a' });
    expect(text).toBe('created: hello');
    expect(audit.entries).toHaveLength(0);
  });
});
