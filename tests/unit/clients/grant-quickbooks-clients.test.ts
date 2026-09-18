/**
 * Covers GrantBackedQuickbooksClients (issue #8): resolves a QuickBooks
 * instance per (employee, Company) from whatever grant the checkpoint
 * (../../../src/auth/company-authorization.ts) already confirmed exists,
 * caching short-lived access tokens per key rather than per process.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { FirestoreGrantStore } from '../../../src/clients/firestore-grant-store';
import { FakeFirestore } from '../../mocks/fake-firestore';

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
});
