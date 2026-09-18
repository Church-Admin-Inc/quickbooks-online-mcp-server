/**
 * Covers issue #8 (authorize a Company on first use) at the HTTP application
 * seam, the same level as streamable-http-application.test.ts and
 * oauth-http-application.test.ts: the real HTTP server, routing, and the
 * Company-authorization checkpoint + browser flow all run for real. Only the
 * Intuit half of the Accounting-scope exchange is faked, via a fake
 * IntuitAccountingAuthorizationProvider injected the same way `oauth` is
 * injected — no network call, no real Intuit app needed.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IntuitAccountingAuthorizationProvider } from '../../src/auth/intuit-accounting-authorization-provider';

const { createStreamableHttpServer, MCP_HTTP_PATH } = await import('../../src/http/create-streamable-http-server');
const { RegisterTool } = await import('../../src/helpers/register-tool');
const { getCurrentCompanyContext } = await import('../../src/context/company-context');
const { OAuthStore } = await import('../../src/auth/oauth-store');
const { CompanyAuthorizationStore } = await import('../../src/auth/company-authorization');
const { FirestoreGrantStore } = await import('../../src/clients/firestore-grant-store');
const { InMemoryFirestore } = await import('../../src/clients/in-memory-firestore');
const { ListCompaniesTool } = await import('../../src/tools/list-companies.tool');

const EMPLOYEE_A = { sub: 'intuit-sub-a', email: 'a@example.com' };
const EMPLOYEE_B = { sub: 'intuit-sub-b', email: 'b@example.com' };
const TOKEN_A = 'bearer-token-a';
const TOKEN_B = 'bearer-token-b';

class FakeCompanyInfoProvider {
  shouldFail = false;
  async fetchCompanyName(params: { realmId: string }): Promise<string> {
    if (this.shouldFail) throw new Error('QuickBooks CompanyInfo lookup failed');
    return `Company Name for ${params.realmId}`;
  }
}

class FakeIntuitAccountingAuthorizationProvider implements IntuitAccountingAuthorizationProvider {
  exchangeShouldFail = false;
  nextRealmId: string | undefined;
  nextRefreshToken = 'refresh-token-from-intuit';

  authorizationUrl(params: { redirectUri: string; state: string }): string {
    return `https://fake-intuit.example/connect?redirect_uri=${encodeURIComponent(params.redirectUri)}&state=${params.state}`;
  }

  async exchangeCodeForGrant(): Promise<{ refreshToken: string; realmId: string; accessToken: string; environment: string }> {
    if (this.exchangeShouldFail) throw new Error('Intuit denied the request');
    return { refreshToken: this.nextRefreshToken, realmId: this.nextRealmId!, accessToken: 'fake-access-token', environment: 'sandbox' };
  }
}

// A minimal echo tool naming a Company, exercising the checkpoint the same
// way any real WRITE tool would (see ../../src/helpers/register-tool.ts).
// realm_id itself is stripped before any handler runs (by design — see
// register-tool.ts's own docstring), so — just like a real handler calling
// QuickbooksClient.getInstance() — this reads the Company that was actually
// resolved from the ambient AsyncLocalStorage context.
function registerEchoRealmTool(server: McpServer): void {
  RegisterTool(server, {
    name: 'create_echo',
    description: 'Test-only: echoes the resolved Company back once authorized',
    schema: z.object({}),
    handler: async () => ({
      content: [{ type: 'text' as const, text: `handled for realm ${getCurrentCompanyContext().realmId}` }],
    }),
  } as any);
  RegisterTool(server, ListCompaniesTool as any);
}

async function listen(server: http.Server): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}`);
}

describe('Company-authorization application (#8)', () => {
  let server: http.Server;
  let base: URL;
  let authorizationProvider: FakeIntuitAccountingAuthorizationProvider;
  let companyInfoProvider: FakeCompanyInfoProvider;
  let grantStore: InstanceType<typeof FirestoreGrantStore>;
  let oauthStore: InstanceType<typeof OAuthStore>;

  beforeEach(async () => {
    authorizationProvider = new FakeIntuitAccountingAuthorizationProvider();
    companyInfoProvider = new FakeCompanyInfoProvider();
    grantStore = new FirestoreGrantStore(new InMemoryFirestore());
    oauthStore = new OAuthStore();
    (oauthStore as unknown as { resolveAccessToken: (token: string) => { sub: string; email: string } | undefined }).resolveAccessToken = (
      token: string
    ) => {
      if (token === TOKEN_A) return EMPLOYEE_A;
      if (token === TOKEN_B) return EMPLOYEE_B;
      return undefined;
    };

    server = createStreamableHttpServer(registerEchoRealmTool, {
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
        authorizationProvider,
        companyInfoProvider,
      },
    });
    base = await listen(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function callTool(token: string, realmId: string): Promise<{ text: string }> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_HTTP_PATH, base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: 'create_echo', arguments: { params: { realm_id: realmId } } });
      const content = result.content as Array<{ type: string; text: string }>;
      return { text: content[0]?.text ?? '' };
    } finally {
      await client.close();
    }
  }

  async function callListCompanies(token: string): Promise<{ text: string }> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_HTTP_PATH, base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: 'list_companies', arguments: { params: {} } });
      const content = result.content as Array<{ type: string; text: string }>;
      return { text: content[0]?.text ?? '' };
    } finally {
      await client.close();
    }
  }

  /** Drives the full browser-side flow: start token -> Intuit consent -> callback -> grant persisted. */
  async function completeAuthorization(authorizeUrl: string, realmId: string): Promise<Response> {
    authorizationProvider.nextRealmId = realmId;
    const startResponse = await fetch(authorizeUrl, { redirect: 'manual' });
    expect(startResponse.status).toBe(302);
    const intuitUrl = new URL(startResponse.headers.get('location')!);
    const state = intuitUrl.searchParams.get('state')!;

    const callbackUrl = new URL('/auth/quickbooks/callback', base);
    callbackUrl.searchParams.set('code', 'intuit-auth-code');
    callbackUrl.searchParams.set('state', state);
    return fetch(callbackUrl);
  }

  it('prompts authorization, rather than erroring, on first use of a Company', async () => {
    const { text } = await callTool(TOKEN_A, 'company-a');
    expect(text).toContain('you have not yet authorized');
    expect(text).toContain('company-a');
    expect(text).toContain(`${base.origin}/auth/quickbooks/authorize?token=`);
  });

  it('stores a grant on completed authorization, and reuses it on the next call (persists across conversations)', async () => {
    const { text: prompt } = await callTool(TOKEN_A, 'company-a');
    const authorizeUrl = prompt.match(/https?:\/\/[^\s)]+/)![0];

    const callbackResponse = await completeAuthorization(authorizeUrl, 'company-a');
    expect(callbackResponse.status).toBe(200);
    expect(await callbackResponse.text()).toContain('QuickBooks authorized');

    const grant = await grantStore.forGrant({ employeeSub: EMPLOYEE_A.sub, realmId: 'company-a' }).read();
    expect(grant?.refreshToken).toBe('refresh-token-from-intuit');
    expect(grant?.companyName).toBe('Company Name for company-a');

    // Reused: a second, independent conversation (fresh MCP client/transport)
    // for the same employee no longer needs to authorize.
    const { text: second } = await callTool(TOKEN_A, 'company-a');
    expect(second).toBe('handled for realm company-a');
  });

  it('falls back to the realm id as the Company name when the CompanyInfo lookup fails, without blocking authorization', async () => {
    companyInfoProvider.shouldFail = true;
    const { text: prompt } = await callTool(TOKEN_A, 'company-a');
    const authorizeUrl = prompt.match(/https?:\/\/[^\s)]+/)![0];

    const callbackResponse = await completeAuthorization(authorizeUrl, 'company-a');
    expect(callbackResponse.status).toBe(200);

    const grant = await grantStore.forGrant({ employeeSub: EMPLOYEE_A.sub, realmId: 'company-a' }).read();
    expect(grant?.companyName).toBe('company-a');
  });

  it('refuses the grant when the employee authorizes a different Company than the one requested', async () => {
    const { text: prompt } = await callTool(TOKEN_A, 'company-a');
    const authorizeUrl = prompt.match(/https?:\/\/[^\s)]+/)![0];

    const callbackResponse = await completeAuthorization(authorizeUrl, 'company-b');
    expect(callbackResponse.status).toBe(400);
    expect(await callbackResponse.text()).toContain('Wrong Company');

    await expect(grantStore.forGrant({ employeeSub: EMPLOYEE_A.sub, realmId: 'company-a' }).read()).resolves.toBeUndefined();
  });

  it('surfaces a failed Intuit exchange with an error page, without creating a grant', async () => {
    const { text: prompt } = await callTool(TOKEN_A, 'company-a');
    const authorizeUrl = prompt.match(/https?:\/\/[^\s)]+/)![0];

    authorizationProvider.exchangeShouldFail = true;
    const callbackResponse = await completeAuthorization(authorizeUrl, 'company-a');
    expect(callbackResponse.status).toBe(400);
    expect(await callbackResponse.text()).toContain('failed');
  });

  it('rejects a stale or already-used start token, and a stale or already-used Intuit state', async () => {
    const staleAuthorize = await fetch(new URL('/auth/quickbooks/authorize?token=not-a-real-token', base));
    expect(staleAuthorize.status).toBe(400);

    const staleCallback = await fetch(new URL('/auth/quickbooks/callback?state=not-a-real-state', base));
    expect(staleCallback.status).toBe(400);
  });

  it('rejects an authorize/callback request missing its token/state param entirely', async () => {
    const noToken = await fetch(new URL('/auth/quickbooks/authorize', base));
    expect(noToken.status).toBe(400);

    const noState = await fetch(new URL('/auth/quickbooks/callback', base));
    expect(noState.status).toBe(400);
  });

  it('routes a call to the grant belonging to the calling employee, never another employee sharing the same Company', async () => {
    const { text: promptA } = await callTool(TOKEN_A, 'shared-company');
    const authorizeUrlA = promptA.match(/https?:\/\/[^\s)]+/)![0];
    await completeAuthorization(authorizeUrlA, 'shared-company');

    // Employee B has never authorized this Company, even though A just did.
    const { text: promptB } = await callTool(TOKEN_B, 'shared-company');
    expect(promptB).toContain('you have not yet authorized');

    const authorizeUrlB = promptB.match(/https?:\/\/[^\s)]+/)![0];
    await completeAuthorization(authorizeUrlB, 'shared-company');

    const { text: secondB } = await callTool(TOKEN_B, 'shared-company');
    expect(secondB).toBe('handled for realm shared-company');

    const grantA = await grantStore.forGrant({ employeeSub: EMPLOYEE_A.sub, realmId: 'shared-company' }).read();
    const grantB = await grantStore.forGrant({ employeeSub: EMPLOYEE_B.sub, realmId: 'shared-company' }).read();
    expect(grantA?.refreshToken).toBe('refresh-token-from-intuit');
    expect(grantB?.refreshToken).toBe('refresh-token-from-intuit');
    expect(grantA).not.toBe(grantB);
  });

  it('does not leak Company state between two calls naming different Companies in one session', async () => {
    await completeAuthorization(
      (await callTool(TOKEN_A, 'company-x')).text.match(/https?:\/\/[^\s)]+/)![0],
      'company-x'
    );
    await completeAuthorization(
      (await callTool(TOKEN_A, 'company-y')).text.match(/https?:\/\/[^\s)]+/)![0],
      'company-y'
    );

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_HTTP_PATH, base), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN_A}` } },
    });
    await client.connect(transport);
    try {
      const [resultX, resultY] = await Promise.all([
        client.callTool({ name: 'create_echo', arguments: { params: { realm_id: 'company-x' } } }),
        client.callTool({ name: 'create_echo', arguments: { params: { realm_id: 'company-y' } } }),
      ]);
      const textX = (resultX.content as Array<{ text: string }>)[0]?.text;
      const textY = (resultY.content as Array<{ text: string }>)[0]?.text;
      expect(textX).toBe('handled for realm company-x');
      expect(textY).toBe('handled for realm company-y');
    } finally {
      await client.close();
    }
  });

  describe('list_companies (issue #9)', () => {
    it('lists the Companies the calling employee has authorized, each with its name, realm_id and health', async () => {
      await completeAuthorization((await callTool(TOKEN_A, 'company-a')).text.match(/https?:\/\/[^\s)]+/)![0], 'company-a');
      await completeAuthorization((await callTool(TOKEN_A, 'company-b')).text.match(/https?:\/\/[^\s)]+/)![0], 'company-b');

      const { text } = await callListCompanies(TOKEN_A);
      const companies = JSON.parse(text);

      expect(companies).toEqual([
        { name: 'Company Name for company-a', realm_id: 'company-a', health: 'healthy' },
        { name: 'Company Name for company-b', realm_id: 'company-b', health: 'healthy' },
      ]);
    });

    it('never lists a Company belonging to a different employee', async () => {
      await completeAuthorization((await callTool(TOKEN_A, 'company-a')).text.match(/https?:\/\/[^\s)]+/)![0], 'company-a');

      const { text } = await callListCompanies(TOKEN_B);
      expect(JSON.parse(text)).toEqual([]);
    });

    it("reflects a Company's real grant health, not just that it was once authorized", async () => {
      await completeAuthorization((await callTool(TOKEN_A, 'company-a')).text.match(/https?:\/\/[^\s)]+/)![0], 'company-a');
      await grantStore.forGrant({ employeeSub: EMPLOYEE_A.sub, realmId: 'company-a' }).recordHealth('unhealthy');

      const { text } = await callListCompanies(TOKEN_A);
      expect(JSON.parse(text)).toEqual([{ name: 'Company Name for company-a', realm_id: 'company-a', health: 'unhealthy' }]);
    });
  });
});
