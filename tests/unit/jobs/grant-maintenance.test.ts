/**
 * Covers GrantMaintenanceJob (issue #12): the daily refresh, weekly
 * re-validation, and 30-day expiry sweeps, plus the alert a Company raises
 * on becoming unhealthy.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { FirestoreGrantStore } from '../../../src/clients/firestore-grant-store';
import { FakeFirestore } from '../../mocks/fake-firestore';
import type { CompanyInfoProvider } from '../../../src/auth/company-info-provider';

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

const { GrantMaintenanceJob, ConsoleAlertNotifier, createDefaultAlertNotifier, createDefaultGrantMaintenanceJob } =
  await import('../../../src/jobs/grant-maintenance.js');

const CONFIG = { clientId: 'client-id', clientSecret: 'client-secret', environment: 'sandbox' };
const KEY_A = { employeeSub: 'emp-1', realmId: 'company-a' };
const KEY_B = { employeeSub: 'emp-1', realmId: 'company-b' };

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return { token: { access_token: 'access-1', refresh_token: 'rotated-refresh', ...overrides } };
}

function fakeAlertNotifier() {
  const notify = jest.fn<(alert: unknown) => Promise<void>>().mockResolvedValue(undefined);
  return { notify };
}

function fakeCompanyInfoProvider(): jest.Mocked<CompanyInfoProvider> {
  return { fetchCompanyName: jest.fn<CompanyInfoProvider['fetchCompanyName']>() };
}

describe('GrantMaintenanceJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('refreshAllGrants (daily job)', () => {
    it('refreshes every grant through the store\'s single-flight refresh path', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a');
      await grantStore.forGrant(KEY_B).create('seed-b');
      mockRefreshUsingToken.mockResolvedValue(tokenResponse());

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier);

      const result = await job.refreshAllGrants();

      expect(result).toEqual({ total: 2, succeeded: 2, failed: [] });
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ refreshToken: 'rotated-refresh' });
      await expect(grantStore.forGrant(KEY_B).read()).resolves.toMatchObject({ refreshToken: 'rotated-refresh' });
      expect(alertNotifier.notify).not.toHaveBeenCalled();
    });

    it('keeps the current refresh token when Intuit does not rotate one back', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a');
      mockRefreshUsingToken.mockResolvedValue({ token: { access_token: 'access-1' } });

      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, fakeAlertNotifier());
      await job.refreshAllGrants();

      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ refreshToken: 'seed-a' });
    });

    it('one grant failing to refresh does not stop the rest of the run', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a');
      await grantStore.forGrant(KEY_B).create('seed-b');

      mockRefreshUsingToken.mockImplementation(async (token: string) => {
        if (token === 'seed-a') throw new Error('transient network error');
        return tokenResponse();
      });

      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, fakeAlertNotifier());
      const result = await job.refreshAllGrants();

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]!.key).toEqual(KEY_A);
      await expect(grantStore.forGrant(KEY_B).read()).resolves.toMatchObject({ refreshToken: 'rotated-refresh' });
    });

    it('marks a grant unhealthy and alerts when Intuit rejects the refresh token', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a', 'Company A');
      mockRefreshUsingToken.mockRejectedValue(deadTokenError());

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier);

      const result = await job.refreshAllGrants();

      expect(result).toEqual({ total: 1, succeeded: 1, failed: [] });
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'unhealthy' });
      expect(alertNotifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ employeeSub: 'emp-1', realmId: 'company-a', companyName: 'Company A' })
      );
    });

    it('does not re-alert a grant that is already unhealthy', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a');
      await grantStore.forGrant(KEY_A).recordHealth('unhealthy');
      mockRefreshUsingToken.mockRejectedValue(deadTokenError());

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier);

      await job.refreshAllGrants();

      expect(alertNotifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('revalidateAllGrants (weekly job)', () => {
    it('leaves a grant healthy when the live CompanyInfo check succeeds', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a', 'Company A');
      mockRefreshUsingToken.mockResolvedValue(tokenResponse());
      const companyInfoProvider = fakeCompanyInfoProvider();
      companyInfoProvider.fetchCompanyName.mockResolvedValue('Company A');

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier, companyInfoProvider);

      const result = await job.revalidateAllGrants();

      expect(result).toEqual({ total: 1, succeeded: 1, failed: [] });
      expect(companyInfoProvider.fetchCompanyName).toHaveBeenCalledWith({
        accessToken: 'access-1',
        realmId: 'company-a',
        environment: 'sandbox',
      });
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'healthy' });
      expect(alertNotifier.notify).not.toHaveBeenCalled();
    });

    it('marks a grant unhealthy and alerts when QuickBooks rejects data access (401/403)', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a', 'Company A');
      mockRefreshUsingToken.mockResolvedValue(tokenResponse());
      const companyInfoProvider = fakeCompanyInfoProvider();
      companyInfoProvider.fetchCompanyName.mockRejectedValue(
        new Error('QuickBooks returned 403 fetching CompanyInfo for realm "company-a"')
      );

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier, companyInfoProvider);

      const result = await job.revalidateAllGrants();

      expect(result).toEqual({ total: 1, succeeded: 1, failed: [] });
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'unhealthy' });
      expect(alertNotifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ realmId: 'company-a', reason: expect.stringContaining('rejected access') })
      );
    });

    it('treats a transient CompanyInfo failure as a failed run, not an unhealthy grant', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a', 'Company A');
      mockRefreshUsingToken.mockResolvedValue(tokenResponse());
      const companyInfoProvider = fakeCompanyInfoProvider();
      companyInfoProvider.fetchCompanyName.mockRejectedValue(
        new Error('QuickBooks returned 503 fetching CompanyInfo for realm "company-a"')
      );

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier, companyInfoProvider);

      const result = await job.revalidateAllGrants();

      expect(result.succeeded).toBe(0);
      expect(result.failed).toHaveLength(1);
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'healthy' });
      expect(alertNotifier.notify).not.toHaveBeenCalled();
    });

    it('treats a transient refresh failure as a failed run, without calling CompanyInfo', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a', 'Company A');
      mockRefreshUsingToken.mockRejectedValue(new Error('transient network error'));
      const companyInfoProvider = fakeCompanyInfoProvider();

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier, companyInfoProvider);

      const result = await job.revalidateAllGrants();

      expect(result).toEqual({ total: 1, succeeded: 0, failed: [{ key: KEY_A, error: expect.any(Error) }] });
      expect(companyInfoProvider.fetchCompanyName).not.toHaveBeenCalled();
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'healthy' });
    });

    it('treats a non-Error CompanyInfo rejection as a transient failure', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a', 'Company A');
      mockRefreshUsingToken.mockResolvedValue(tokenResponse());
      const companyInfoProvider = fakeCompanyInfoProvider();
      companyInfoProvider.fetchCompanyName.mockRejectedValue('boom');

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier, companyInfoProvider);

      const result = await job.revalidateAllGrants();

      expect(result.succeeded).toBe(0);
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'healthy' });
    });

    it('marks a grant unhealthy when the refresh token itself is rejected, without calling CompanyInfo', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a', 'Company A');
      mockRefreshUsingToken.mockRejectedValue(deadTokenError());
      const companyInfoProvider = fakeCompanyInfoProvider();

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier, companyInfoProvider);

      await job.revalidateAllGrants();

      expect(companyInfoProvider.fetchCompanyName).not.toHaveBeenCalled();
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'unhealthy' });
    });
  });

  describe('expireStaleGrants', () => {
    it('defaults "now" to the current time when not given one', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a');

      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, fakeAlertNotifier());
      const result = await job.expireStaleGrants();

      expect(result).toEqual({ total: 1, succeeded: 1, failed: [] });
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'healthy' });
    });

    it('marks a grant unhealthy and alerts once it has been unused for 30+ days', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a', 'Company A');

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier);

      const thirtyOneDaysLater = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
      const result = await job.expireStaleGrants(thirtyOneDaysLater);

      expect(result).toEqual({ total: 1, succeeded: 1, failed: [] });
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'unhealthy' });
      expect(alertNotifier.notify).toHaveBeenCalledWith(
        expect.objectContaining({ realmId: 'company-a', reason: expect.stringContaining('30 days') })
      );
    });

    it('leaves a grant used within the last 30 days alone', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a');
      await grantStore.forGrant(KEY_A).recordUse();

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier);

      const result = await job.expireStaleGrants(new Date());

      expect(result).toEqual({ total: 1, succeeded: 1, failed: [] });
      await expect(grantStore.forGrant(KEY_A).read()).resolves.toMatchObject({ health: 'healthy' });
      expect(alertNotifier.notify).not.toHaveBeenCalled();
    });

    it('leaves an already-unhealthy grant alone, without re-alerting', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      await grantStore.forGrant(KEY_A).create('seed-a');
      await grantStore.forGrant(KEY_A).recordHealth('unhealthy');

      const alertNotifier = fakeAlertNotifier();
      const job = new GrantMaintenanceJob(grantStore, () => CONFIG, alertNotifier);

      await job.expireStaleGrants(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000));

      expect(alertNotifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('ConsoleAlertNotifier / defaults', () => {
    it('logs the alert to stderr', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await new ConsoleAlertNotifier().notify({
        employeeSub: 'emp-1',
        realmId: 'company-a',
        companyName: 'Company A',
        reason: 'unused for 30 days',
      });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Company "Company A"'));
      spy.mockRestore();
    });

    it('createDefaultAlertNotifier returns a ConsoleAlertNotifier', () => {
      expect(createDefaultAlertNotifier()).toBeInstanceOf(ConsoleAlertNotifier);
    });

    it('createDefaultGrantMaintenanceJob wires a job with the given store and config loader', async () => {
      const grantStore = new FirestoreGrantStore(new FakeFirestore());
      const job = createDefaultGrantMaintenanceJob(grantStore, () => CONFIG);
      expect(job).toBeInstanceOf(GrantMaintenanceJob);
      await expect(job.refreshAllGrants()).resolves.toEqual({ total: 0, succeeded: 0, failed: [] });
    });
  });
});
