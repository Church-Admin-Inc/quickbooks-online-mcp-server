/**
 * Covers QuickbooksClient's multi-tenant resolution hook (issue #8): when an
 * authenticated employee is active AND a resolver has been registered (see
 * ../../../src/clients/grant-quickbooks-clients.ts), getInstance() and
 * getAuthCredentials() route through it instead of the single-tenant
 * process-wide client, keyed by employee AND Company. Every other existing
 * test in this suite exercises the "no employee context" fallback already;
 * this file is scoped to the branch itself.
 */
import { jest } from '@jest/globals';

process.env.QUICKBOOKS_CLIENT_ID = 'test-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'test-client-secret';
process.env.QUICKBOOKS_REFRESH_TOKEN = 'seed-refresh-token';
process.env.QUICKBOOKS_REALM_ID = 'default-realm';
process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
process.env.QUICKBOOKS_REDIRECT_URI = 'https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl';

jest.unstable_mockModule('dotenv', () => ({ default: { config: jest.fn(), parse: jest.fn(() => ({})) } }));

const { QuickbooksClient, setMultiTenantResolver } = await import('../../../src/clients/quickbooks-client.js');
const { runWithEmployeeContext } = await import('../../../src/context/employee-context.js');
const { runWithCompanyContext } = await import('../../../src/context/company-context.js');

describe('QuickbooksClient multi-tenant resolution (#8)', () => {
  afterEach(() => setMultiTenantResolver(undefined));

  it('routes getInstance() through the resolver, keyed by employee and Company', async () => {
    const fakeInstance = { marker: 'multi-tenant' } as any;
    const resolver = {
      getInstance: jest.fn(async () => fakeInstance),
      getAuthCredentials: jest.fn(),
    };
    setMultiTenantResolver(resolver as any);

    const result = await runWithEmployeeContext({ sub: 'emp-1', email: 'e1@example.com' }, () =>
      runWithCompanyContext({ realmId: 'company-a' }, () => QuickbooksClient.getInstance())
    );

    expect(result).toBe(fakeInstance);
    expect(resolver.getInstance).toHaveBeenCalledWith('emp-1', 'company-a');
    expect(resolver.getAuthCredentials).not.toHaveBeenCalled();
  });

  it('routes getAuthCredentials() through the resolver, keyed by employee and Company', async () => {
    const creds = { accessToken: 'tok', realmId: 'company-b', isSandbox: true };
    const resolver = {
      getInstance: jest.fn(),
      getAuthCredentials: jest.fn(async () => creds),
    };
    setMultiTenantResolver(resolver as any);

    const result = await runWithEmployeeContext({ sub: 'emp-2', email: 'e2@example.com' }, () =>
      runWithCompanyContext({ realmId: 'company-b' }, () => QuickbooksClient.getAuthCredentials())
    );

    expect(result).toBe(creds);
    expect(resolver.getAuthCredentials).toHaveBeenCalledWith('emp-2', 'company-b');
  });

  it('falls back to single-tenant resolution when no employee context is active', async () => {
    const resolver = { getInstance: jest.fn(), getAuthCredentials: jest.fn() };
    setMultiTenantResolver(resolver as any);

    await expect(
      runWithCompanyContext({ realmId: 'unregistered-company' }, () => QuickbooksClient.getInstance())
    ).rejects.toThrow(/No QuickBooks client is registered/);
    await expect(
      runWithCompanyContext({ realmId: 'unregistered-company' }, () => QuickbooksClient.getAuthCredentials())
    ).rejects.toThrow(/No QuickBooks client is registered/);

    expect(resolver.getInstance).not.toHaveBeenCalled();
    expect(resolver.getAuthCredentials).not.toHaveBeenCalled();
  });

  it('falls back to single-tenant resolution when an employee is active but no resolver is registered', async () => {
    setMultiTenantResolver(undefined);

    await expect(
      runWithEmployeeContext({ sub: 'emp-3', email: 'e3@example.com' }, () =>
        runWithCompanyContext({ realmId: 'unregistered-company' }, () => QuickbooksClient.getInstance())
      )
    ).rejects.toThrow(/No QuickBooks client is registered/);
  });
});
