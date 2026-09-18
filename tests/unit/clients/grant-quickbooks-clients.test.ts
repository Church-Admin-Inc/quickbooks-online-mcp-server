/**
 * Covers GrantBackedQuickbooksClients (issue #8): resolves a QuickBooks
 * instance per (employee, Company) from whatever grant the checkpoint
 * (../../../src/auth/company-authorization.ts) already confirmed exists,
 * caching short-lived access tokens per key rather than per process.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { FirestoreGrantStore } from '../../../src/clients/firestore-grant-store';
import { FakeFirestore } from '../../mocks/fake-firestore';
import { CompanyAuthorizationStore } from '../../../src/auth/company-authorization';
import { runWithRequestContext } from '../../../src/context/request-context';

function deadTokenError(code = 400) {
  return Object.assign(new Error(`Request failed with status code ${code}`), {
    error_description: '',
    authResponse: { status: () => undefined },
  });
}

const mockRefreshUsingToken = jest.fn<(token: string) => Promise<unknown>>();

class MockOAuthClient {
  constructor(public config: unknown) {}
  refreshUsingToken(token: string) {
    return mockRefreshUsingToken(token);
  }
}
jest.unstable_mockModule('intuit-oauth', () => ({ default: MockOAuthClient }));

const constructedQuickBooksArgs: unknown[][] = [];
jest.unstable_mockModule('node-quickbooks', () => ({
  default: class MockQuickBooks {
    constructor(...args: unknown[]) {
      constructedQuickBooksArgs.push(args);
    }
  },
}));

const { GrantBackedQuickbooksClients } = await import('../../../src/clients/grant-quickbooks-clients.js');

const CONFIG = { clientId: 'client-id', clientSecret: 'client-secret', environment: 'sandbox' };

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return { token: { access_token: 'access-1', expires_in: 3600, refresh_token: 'rotated-refresh', ...overrides } };
}

describe('GrantBackedQuickbooksClients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    constructedQuickBooksArgs.length = 0;
  });

  it('resolves auth credentials for an existing grant, rotating and persisting the refresh token', async () => {
    const grantStore = new FirestoreGrantStore(new FakeFirestore());
    await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
    mockRefreshUsingToken.mockResolvedValue(tokenResponse());

    const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);
    const creds = await clients.getAuthCredentials('emp-1', 'company-a');

    expect(creds).toEqual({ accessToken: 'access-1', realmId: 'company-a', isSandbox: true });
    expect(mockRefreshUsingToken).toHaveBeenCalledWith('seed-refresh-token');

    const grant = await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).read();
    expect(grant?.refreshToken).toBe('rotated-refresh');
    expect(grant?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('builds a QuickBooks instance scoped to the resolved access token and realm', async () => {
    const grantStore = new FirestoreGrantStore(new FakeFirestore());
    await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
    mockRefreshUsingToken.mockResolvedValue(tokenResponse());

    const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);
    await clients.getInstance('emp-1', 'company-a');

    expect(constructedQuickBooksArgs[0]).toEqual([
      'client-id',
      'client-secret',
      'access-1',
      false,
      'company-a',
      true,
      false,
      null,
      '2.0',
    ]);
  });

  it('caches the access token and does not re-refresh until it is near expiry', async () => {
    const grantStore = new FirestoreGrantStore(new FakeFirestore());
    await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
    mockRefreshUsingToken.mockResolvedValue(tokenResponse());

    const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);
    await clients.getAuthCredentials('emp-1', 'company-a');
    await clients.getAuthCredentials('emp-1', 'company-a');

    expect(mockRefreshUsingToken).toHaveBeenCalledTimes(1);
  });

  it('keeps two employees sharing a Company on separate cached access tokens', async () => {
    const grantStore = new FirestoreGrantStore(new FakeFirestore());
    await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('emp-1-refresh');
    await grantStore.forGrant({ employeeSub: 'emp-2', realmId: 'company-a' }).create('emp-2-refresh');
    mockRefreshUsingToken.mockImplementation(async (token: string) => tokenResponse({ access_token: `access-for-${token}` }));

    const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);
    const credsA = await clients.getAuthCredentials('emp-1', 'company-a');
    const credsB = await clients.getAuthCredentials('emp-2', 'company-a');

    expect(credsA.accessToken).toBe('access-for-emp-1-refresh');
    expect(credsB.accessToken).toBe('access-for-emp-2-refresh');
  });

  it('rejects with an actionable message when no grant exists for the (employee, Company) pair', async () => {
    const grantStore = new FirestoreGrantStore(new FakeFirestore());
    const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);

    await expect(clients.getAuthCredentials('emp-1', 'company-a')).rejects.toThrow(
      /No QuickBooks grant for employee "emp-1" and Company "company-a".*realm_id/
    );
    expect(mockRefreshUsingToken).not.toHaveBeenCalled();
  });

  it('propagates a non-GrantNotFoundError refresh failure unchanged', async () => {
    const grantStore = new FirestoreGrantStore(new FakeFirestore());
    await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
    mockRefreshUsingToken.mockRejectedValue(new Error('Intuit is down'));

    const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);
    await expect(clients.getAuthCredentials('emp-1', 'company-a')).rejects.toThrow('Intuit is down');
  });

  describe('dead-grant handling (issue #9)', () => {
    it('marks the grant unhealthy and replaces a genuine dead-token error with a plain-language, Company-named message', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
      mockRefreshUsingToken.mockRejectedValue(deadTokenError(400));

      const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);
      await expect(clients.getAuthCredentials('emp-1', 'company-a')).rejects.toThrow(
        /Company "company-a" is no longer valid and must be re-authorized/
      );

      const grant = await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).read();
      expect(grant?.health).toBe('unhealthy');
    });

    it('never lets the raw Intuit error text reach the caller for a dead grant', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
      mockRefreshUsingToken.mockRejectedValue(deadTokenError(401));

      const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);
      await expect(clients.getAuthCredentials('emp-1', 'company-a')).rejects.toThrow(
        expect.not.stringContaining('status code')
      );
    });

    it('includes a fresh re-authorization link when a pending store and request origin are both available', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
      mockRefreshUsingToken.mockRejectedValue(deadTokenError(400));

      const pending = new CompanyAuthorizationStore();
      const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG, pending);

      await expect(
        runWithRequestContext({ origin: 'https://qbo.example.com' }, () =>
          clients.getAuthCredentials('emp-1', 'company-a')
        )
      ).rejects.toThrow('https://qbo.example.com/auth/quickbooks/authorize?token=');
    });

    it('falls back to a retry instruction, with no link, when no pending store was supplied', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
      mockRefreshUsingToken.mockRejectedValue(deadTokenError(400));

      const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG);
      await expect(
        runWithRequestContext({ origin: 'https://qbo.example.com' }, () => clients.getAuthCredentials('emp-1', 'company-a'))
      ).rejects.toThrow('Retry the call to get a fresh authorization link.');
    });

    it('falls back to a retry instruction, with no link, when a pending store was supplied but no request origin is active', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant({ employeeSub: 'emp-1', realmId: 'company-a' }).create('seed-refresh-token');
      mockRefreshUsingToken.mockRejectedValue(deadTokenError(400));

      const pending = new CompanyAuthorizationStore();
      const clients = new GrantBackedQuickbooksClients(grantStore, () => CONFIG, pending);
      await expect(clients.getAuthCredentials('emp-1', 'company-a')).rejects.toThrow(
        'Retry the call to get a fresh authorization link.'
      );
    });

    it('falls back to the realm id when re-reading the grant for its companyName fails', async () => {
      const handle = {
        key: { employeeSub: 'emp-1', realmId: 'company-a' },
        read: jest.fn(async () => {
          throw new Error('store down');
        }),
        create: jest.fn(),
        refresh: jest.fn(async () => {
          throw deadTokenError(400);
        }),
        recordUse: jest.fn(),
        recordHealth: jest.fn(async () => undefined),
      };
      const grantStore = { forGrant: jest.fn(() => handle), listForEmployee: jest.fn() };

      const clients = new GrantBackedQuickbooksClients(grantStore as any, () => CONFIG);
      await expect(clients.getAuthCredentials('emp-1', 'company-a')).rejects.toThrow(
        'Company "company-a" is no longer valid and must be re-authorized'
      );
    });

    it('swallows a recordHealth failure and still surfaces the plain-language dead-connection message', async () => {
      const recordHealth = jest.fn(async (_health: string) => {
        throw new Error('store unavailable');
      });
      const handle = {
        key: { employeeSub: 'emp-1', realmId: 'company-a' },
        read: jest.fn(async () => undefined),
        create: jest.fn(),
        refresh: jest.fn(async () => {
          throw deadTokenError(400);
        }),
        recordUse: jest.fn(),
        recordHealth,
      };
      const grantStore = { forGrant: jest.fn(() => handle), listForEmployee: jest.fn() };

      const clients = new GrantBackedQuickbooksClients(grantStore as any, () => CONFIG);
      await expect(clients.getAuthCredentials('emp-1', 'company-a')).rejects.toThrow(
        /no longer valid and must be re-authorized/
      );
      expect(recordHealth).toHaveBeenCalledWith('unhealthy');
    });
  });
});
