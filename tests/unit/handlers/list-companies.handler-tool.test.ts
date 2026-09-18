/**
 * Covers issue #9's list_companies at the handler+tool seam: each Company's
 * name, realm_id and connection health, resolved from the calling employee's
 * grants, and a clear message rather than a raw error when the process has
 * no multi-Company context to answer from (stdio/single-tenant).
 */
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { listCompanies, setListCompaniesDeps } from '../../../src/handlers/list-companies.handler';
import { ListCompaniesTool } from '../../../src/tools/list-companies.tool';
import { runWithEmployeeContext } from '../../../src/context/employee-context';
import type { Grant, GrantStore } from '../../../src/clients/firestore-grant-store';

const EMPLOYEE = { sub: 'emp-1', email: 'emp@example.com' };

function grantFixture(overrides: Partial<Grant> = {}): Grant {
  return {
    employeeSub: EMPLOYEE.sub,
    realmId: 'company-a',
    refreshToken: 'rt',
    companyName: 'Company A',
    createdAt: new Date(),
    lastRefreshedAt: new Date(),
    lastUsedAt: undefined,
    health: 'healthy',
    ...overrides,
  };
}

function fakeGrantStore(grants: Grant[]): GrantStore {
  return {
    forGrant: jest.fn(),
    listForEmployee: jest.fn(async () => grants),
  } as unknown as GrantStore;
}

describe('list_companies handler', () => {
  afterEach(() => setListCompaniesDeps(undefined));

  it('lists every Company the calling employee holds a grant for, with name, realm_id and health', async () => {
    const grantStore = fakeGrantStore([
      grantFixture({ realmId: 'company-b', companyName: 'Zeta Corp', health: 'healthy' }),
      grantFixture({ realmId: 'company-a', companyName: 'Acme Inc', health: 'unhealthy' }),
    ]);
    setListCompaniesDeps({ grantStore });

    const result = await runWithEmployeeContext(EMPLOYEE, () => listCompanies());

    expect(result.isError).toBe(false);
    // Sorted by name, so Acme (unhealthy) comes before Zeta (healthy).
    expect(result.result).toEqual([
      { name: 'Acme Inc', realm_id: 'company-a', health: 'unhealthy' },
      { name: 'Zeta Corp', realm_id: 'company-b', health: 'healthy' },
    ]);
    expect(grantStore.listForEmployee).toHaveBeenCalledWith(EMPLOYEE.sub);
  });

  it('returns an empty list for an employee who has authorized no Companies yet', async () => {
    setListCompaniesDeps({ grantStore: fakeGrantStore([]) });

    const result = await runWithEmployeeContext(EMPLOYEE, () => listCompanies());

    expect(result).toEqual({ result: [], isError: false, error: null });
  });

  it('returns a clear, non-error-shaped explanation outside multi-Company mode (no employee context)', async () => {
    setListCompaniesDeps({ grantStore: fakeGrantStore([]) });

    const result = await listCompanies();

    expect(result.isError).toBe(true);
    expect(result.error).toContain('single-tenant/stdio');
  });

  it('returns the same explanation when no deps were ever configured, even with an employee context active', async () => {
    const result = await runWithEmployeeContext(EMPLOYEE, () => listCompanies());

    expect(result.isError).toBe(true);
    expect(result.error).toContain('single-tenant/stdio');
  });

  it('formats a grant-store failure as an error rather than throwing', async () => {
    const grantStore = {
      forGrant: jest.fn(),
      listForEmployee: jest.fn(async () => {
        throw new Error('Firestore is unavailable');
      }),
    } as unknown as GrantStore;
    setListCompaniesDeps({ grantStore });

    const result = await runWithEmployeeContext(EMPLOYEE, () => listCompanies());

    expect(result.isError).toBe(true);
    expect(result.error).toContain('Firestore is unavailable');
  });
});

describe('ListCompaniesTool', () => {
  afterEach(() => setListCompaniesDeps(undefined));

  it('exposes a parameterless tool and serializes a successful list', async () => {
    setListCompaniesDeps({
      grantStore: fakeGrantStore([grantFixture({ companyName: 'Acme Inc', realmId: 'company-a', health: 'healthy' })]),
    });

    const result = await runWithEmployeeContext(EMPLOYEE, () => ListCompaniesTool.handler({ params: {} } as any, {} as any));

    expect(ListCompaniesTool.name).toBe('list_companies');
    expect(ListCompaniesTool.schema.parse({})).toEqual({});
    expect(result).toEqual({
      content: [
        { type: 'text', text: JSON.stringify([{ name: 'Acme Inc', realm_id: 'company-a', health: 'healthy' }], null, 2) },
      ],
    });
  });

  it('serializes handler errors for MCP clients', async () => {
    const result = await ListCompaniesTool.handler({ params: {} } as any, {} as any);

    expect((result.content[0] as { text: string }).text).toContain('Error: ');
    expect((result.content[0] as { text: string }).text).toContain('single-tenant/stdio');
  });
});
