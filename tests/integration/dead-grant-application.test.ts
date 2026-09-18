/**
 * Covers issue #9's core acceptance criterion at the HTTP application seam:
 * when a Company's QuickBooks connection dies mid-call, the employee sees a
 * plain-language, Company-named re-authorization message — never raw Intuit
 * error text — and the grant's health is marked unhealthy so the next call is
 * caught by the authorization checkpoint instead of failing the same way
 * again. Unit-level coverage of the classification/message logic itself lives
 * in tests/unit/clients/grant-quickbooks-clients.test.ts; this suite drives
 * the same failure through a real tool call over the real HTTP transport.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';

// quickbooks-client.ts throws at module load if these are unset — this suite
// imports setMultiTenantResolver from it, which loads the module for real.
process.env.QUICKBOOKS_CLIENT_ID = 'test-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'test-client-secret';
process.env.QUICKBOOKS_REDIRECT_URI = 'https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl';

const mockRefreshUsingToken = jest.fn<(token: string) => Promise<unknown>>();
jest.unstable_mockModule('intuit-oauth', () => ({
  default: class MockOAuthClient {
    static scopes: { Accounting: string } = { Accounting: 'com.intuit.quickbooks.accounting' };
    constructor(public config: unknown) {}
    refreshUsingToken(token: string) {
      return mockRefreshUsingToken(token);
    }
  },
}));
jest.unstable_mockModule('node-quickbooks', () => ({
  default: class MockQuickBooks {
    constructor(..._args: unknown[]) {}
    getPreferences(cb: (err: unknown, prefs: unknown) => void) {
      cb(null, { ok: true });
    }
  },
}));

const { createStreamableHttpServer, MCP_HTTP_PATH } = await import('../../src/http/create-streamable-http-server');
const { RegisterTool } = await import('../../src/helpers/register-tool');
const { GetPreferencesTool } = await import('../../src/tools/get-preferences.tool');
const { OAuthStore } = await import('../../src/auth/oauth-store');
const { CompanyAuthorizationStore } = await import('../../src/auth/company-authorization');
const { FirestoreGrantStore } = await import('../../src/clients/firestore-grant-store');
const { InMemoryFirestore } = await import('../../src/clients/in-memory-firestore');
const { GrantBackedQuickbooksClients } = await import('../../src/clients/grant-quickbooks-clients');
const { setMultiTenantResolver } = await import('../../src/clients/quickbooks-client');

const EMPLOYEE = { sub: 'intuit-sub-a', email: 'a@example.com' };
const TOKEN = 'bearer-token-a';

function deadTokenError() {
  return Object.assign(new Error('Request failed with status code 400'), {
    authResponse: { status: () => undefined },
  });
}

async function listen(server: http.Server): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}`);
}

async function callGetPreferences(base: URL, realmId: string): Promise<string> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_HTTP_PATH, base), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'get_preferences', arguments: { params: { realm_id: realmId } } });
    const content = result.content as Array<{ type: string; text: string }>;
    return content[0]?.text ?? '';
  } finally {
    await client.close();
  }
}

describe('Dead-grant re-authorization at the HTTP application seam (#9)', () => {
  let server: http.Server;
  let base: URL;
  let grantStore: InstanceType<typeof FirestoreGrantStore>;

  beforeEach(async () => {
    jest.clearAllMocks();
    grantStore = new FirestoreGrantStore(new InMemoryFirestore());
    await grantStore.forGrant({ employeeSub: EMPLOYEE.sub, realmId: 'company-a' }).create('seed-refresh-token', 'Acme Inc');

    const pending = new CompanyAuthorizationStore();
    setMultiTenantResolver(
      new GrantBackedQuickbooksClients(grantStore, () => ({ clientId: 'id', clientSecret: 'secret', environment: 'sandbox' }), pending)
    );

    const oauthStore = new OAuthStore();
    (oauthStore as unknown as { resolveAccessToken: (t: string) => { sub: string; email: string } | undefined }).resolveAccessToken = (
      token
    ) => (token === TOKEN ? EMPLOYEE : undefined);

    server = createStreamableHttpServer(
      (mcpServer) => {
        RegisterTool(mcpServer, GetPreferencesTool as any);
      },
      {
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
          pending,
          authorizationProvider: {
            authorizationUrl: () => {
              throw new Error('not used in this suite');
            },
            exchangeCodeForGrant: async () => {
              throw new Error('not used in this suite');
            },
          },
          companyInfoProvider: {
            fetchCompanyName: async () => {
              throw new Error('not used in this suite');
            },
          },
        },
      }
    );
    base = await listen(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setMultiTenantResolver(undefined);
  });

  it('replaces a dead-token failure with a plain-language, Company-named message naming Acme Inc, not the raw realm id or Intuit error text', async () => {
    mockRefreshUsingToken.mockRejectedValue(deadTokenError());

    const text = await callGetPreferences(base, 'company-a');

    expect(text).toContain('Company "Acme Inc"');
    expect(text).toContain('no longer valid and must be re-authorized');
    expect(text).not.toContain('status code');
    expect(text).not.toContain('company-a');
  });

  it('marks the grant unhealthy, so the very next call is caught by the authorization checkpoint instead of failing the same way again', async () => {
    mockRefreshUsingToken.mockRejectedValue(deadTokenError());
    await callGetPreferences(base, 'company-a');

    const grant = await grantStore.forGrant({ employeeSub: EMPLOYEE.sub, realmId: 'company-a' }).read();
    expect(grant?.health).toBe('unhealthy');

    const secondText = await callGetPreferences(base, 'company-a');
    expect(secondText).toContain('no longer valid and must be re-authorized');
    expect(secondText).toContain('/auth/quickbooks/authorize?token=');
  });

  it('leaves a healthy connection unaffected', async () => {
    mockRefreshUsingToken.mockResolvedValue({ token: { access_token: 'at-1', expires_in: 3600 } });

    const text = await callGetPreferences(base, 'company-a');

    expect(text).toBe(JSON.stringify({ ok: true }, null, 2));
  });
});
