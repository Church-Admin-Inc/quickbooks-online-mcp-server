import { describe, it, expect, jest } from '@jest/globals';
import {
  CompanyAuthorizationStore,
  checkCompanyAuthorization,
  COMPANY_AUTHORIZE_PATH,
} from '../../../src/auth/company-authorization';
import type { GrantStore, GrantHandle, Grant } from '../../../src/clients/firestore-grant-store';

function fakeGrantStore(grant: Grant | undefined): GrantStore {
  const handle: GrantHandle = {
    key: { employeeSub: 'irrelevant', realmId: 'irrelevant' },
    read: jest.fn(async () => grant),
    create: jest.fn(),
    refresh: jest.fn(),
    recordUse: jest.fn(),
    recordHealth: jest.fn(),
  } as unknown as GrantHandle;
  return { forGrant: jest.fn(() => handle) } as unknown as GrantStore;
}

const EMPLOYEE = { sub: 'emp-1', email: 'emp@example.com' };
const HEALTHY_GRANT: Grant = {
  employeeSub: EMPLOYEE.sub,
  realmId: 'company-a',
  refreshToken: 'rt',
  createdAt: new Date(),
  lastRefreshedAt: new Date(),
  lastUsedAt: undefined,
  health: 'healthy',
};

describe('checkCompanyAuthorization', () => {
  it('authorizes when the employee holds a healthy grant for the Company', async () => {
    const grantStore = fakeGrantStore(HEALTHY_GRANT);
    const result = await checkCompanyAuthorization(
      { grantStore, pending: new CompanyAuthorizationStore() },
      EMPLOYEE,
      'company-a',
      'https://qbo.example.com'
    );
    expect(result).toEqual({ authorized: true });
  });

  it('prompts authorization, rather than erroring, when no grant exists', async () => {
    const grantStore = fakeGrantStore(undefined);
    const result = await checkCompanyAuthorization(
      { grantStore, pending: new CompanyAuthorizationStore() },
      EMPLOYEE,
      'company-a',
      'https://qbo.example.com'
    );
    expect(result.authorized).toBe(false);
    if (result.authorized) throw new Error('unreachable');
    expect(result.authorizeUrl.startsWith(`https://qbo.example.com${COMPANY_AUTHORIZE_PATH}?token=`)).toBe(true);
  });

  it('prompts re-authorization when the existing grant is unhealthy', async () => {
    const grantStore = fakeGrantStore({ ...HEALTHY_GRANT, health: 'unhealthy' });
    const result = await checkCompanyAuthorization(
      { grantStore, pending: new CompanyAuthorizationStore() },
      EMPLOYEE,
      'company-a',
      'https://qbo.example.com'
    );
    expect(result.authorized).toBe(false);
  });

  it('checks the grant keyed by the calling employee and the named Company, never another employee', async () => {
    const grantStore = fakeGrantStore(undefined);
    await checkCompanyAuthorization(
      { grantStore, pending: new CompanyAuthorizationStore() },
      EMPLOYEE,
      'company-a',
      'https://qbo.example.com'
    );
    expect(grantStore.forGrant).toHaveBeenCalledWith({ employeeSub: EMPLOYEE.sub, realmId: 'company-a' });
  });
});

describe('CompanyAuthorizationStore', () => {
  it('consumes a start token exactly once', () => {
    const store = new CompanyAuthorizationStore();
    const token = store.create({ employeeSub: 'emp-1', realmId: 'company-a' });
    expect(store.consume(token)).toEqual(expect.objectContaining({ employeeSub: 'emp-1', realmId: 'company-a' }));
    expect(store.consume(token)).toBeUndefined();
  });

  it('returns undefined for an unknown token', () => {
    const store = new CompanyAuthorizationStore();
    expect(store.consume('not-a-real-token')).toBeUndefined();
  });

  it('returns undefined for an expired token, and sweeps it on the next create', () => {
    const store = new CompanyAuthorizationStore();
    const token = store.create({ employeeSub: 'emp-1', realmId: 'company-a' }, -1);
    expect(store.size()).toBe(1);
    store.create({ employeeSub: 'emp-2', realmId: 'company-b' });
    expect(store.consume(token)).toBeUndefined();
  });

  it('sweeps only an expired entry, leaving one that is still live in the same sweep untouched', () => {
    const store = new CompanyAuthorizationStore();
    const liveToken = store.create({ employeeSub: 'emp-1', realmId: 'company-a' });
    const expiredToken = store.create({ employeeSub: 'emp-2', realmId: 'company-b' }, -1);
    // This third create() call sweeps a map holding BOTH the still-live token
    // above (must survive) and the expired one (must be removed).
    store.create({ employeeSub: 'emp-3', realmId: 'company-c' });

    expect(store.consume(expiredToken)).toBeUndefined();
    expect(store.consume(liveToken)).toEqual(expect.objectContaining({ employeeSub: 'emp-1', realmId: 'company-a' }));
  });

  it('reports its current size', () => {
    const store = new CompanyAuthorizationStore();
    expect(store.size()).toBe(0);
    store.create({ employeeSub: 'emp-1', realmId: 'company-a' });
    expect(store.size()).toBe(1);
  });
});
