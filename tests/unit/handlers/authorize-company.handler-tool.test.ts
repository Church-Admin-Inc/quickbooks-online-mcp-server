import { describe, it, expect, afterEach } from '@jest/globals';
import {
  authorizeCompany,
  setAuthorizeCompanyDeps,
} from '../../../src/handlers/authorize-company.handler';
import { AuthorizeCompanyTool } from '../../../src/tools/authorize-company.tool';
import {
  CompanyAuthorizationStore,
  COMPANY_AUTHORIZE_PATH,
} from '../../../src/auth/company-authorization';
import { runWithEmployeeContext } from '../../../src/context/employee-context';
import { runWithRequestContext } from '../../../src/context/request-context';

const EMPLOYEE = { sub: 'emp-1', email: 'emp@example.com' };
const ORIGIN = 'https://qbo.example.com';

afterEach(() => setAuthorizeCompanyDeps(undefined));

function inContext<T>(fn: () => T): T {
  return runWithEmployeeContext(EMPLOYEE, () => runWithRequestContext({ origin: ORIGIN }, fn));
}

describe('authorizeCompany', () => {
  it('mints an authorize URL that names no Company', async () => {
    const pending = new CompanyAuthorizationStore();
    setAuthorizeCompanyDeps({ pending });

    const response = await inContext(() => authorizeCompany());

    expect(response.isError).toBe(false);
    const url = new URL(response.result!.authorize_url);
    expect(url.origin + url.pathname).toBe(`${ORIGIN}${COMPANY_AUTHORIZE_PATH}`);

    // The pending record binds the employee but leaves the Company open, so
    // whichever one they pick on Intuit's screen is the one that gets stored.
    const record = pending.consume(url.searchParams.get('token')!);
    expect(record).toEqual(expect.objectContaining({ employeeSub: EMPLOYEE.sub }));
    expect(record!.realmId).toBeUndefined();
  });

  it('refuses outside multi-Company mode', async () => {
    const response = await authorizeCompany();
    expect(response.isError).toBe(true);
    expect(response.error).toMatch(/multi-Company mode/);
  });

  it('reports a failure to mint rather than throwing out of the tool call', async () => {
    const pending = new CompanyAuthorizationStore();
    pending.create = () => {
      throw new Error('token store unavailable');
    };
    setAuthorizeCompanyDeps({ pending });

    const response = await inContext(() => authorizeCompany());
    expect(response.isError).toBe(true);
    expect(response.error).toContain('token store unavailable');
  });

  it('refuses when no request origin is available to build an absolute link', async () => {
    setAuthorizeCompanyDeps({ pending: new CompanyAuthorizationStore() });
    const response = await runWithEmployeeContext(EMPLOYEE, () => authorizeCompany());
    expect(response.isError).toBe(true);
  });
});

describe('AuthorizeCompanyTool', () => {
  it('takes no parameters, so no Realm ID is needed to start', () => {
    expect(Object.keys((AuthorizeCompanyTool.schema as any).shape)).toEqual([]);
  });

  it('renders the link as Markdown so clients show it as clickable', async () => {
    setAuthorizeCompanyDeps({ pending: new CompanyAuthorizationStore() });
    const result: any = await inContext(() => (AuthorizeCompanyTool.handler as any)({ params: {} }));
    expect(result.content[0].text).toMatch(/\[Connect a QuickBooks Company\]\(https:\/\/qbo\.example\.com/);
  });

  it('surfaces the refusal as text when it cannot mint a link', async () => {
    const result: any = await (AuthorizeCompanyTool.handler as any)({ params: {} });
    expect(result.content[0].text).toMatch(/^Error: /);
  });
});
