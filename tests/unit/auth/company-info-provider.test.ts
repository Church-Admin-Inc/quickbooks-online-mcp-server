import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { IntuitCompanyInfoProvider } from '../../../src/auth/company-info-provider';

describe('IntuitCompanyInfoProvider', () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn<typeof fetch>();

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch.mockReset();
  });

  it('fetches the Company name from the sandbox host, authenticated with the given access token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ CompanyInfo: { CompanyName: 'Acme Inc' } }),
    } as Response);

    const provider = new IntuitCompanyInfoProvider();
    const name = await provider.fetchCompanyName({ accessToken: 'at-1', realmId: 'company-a', environment: 'sandbox' });

    expect(name).toBe('Acme Inc');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://sandbox-quickbooks.api.intuit.com/v3/company/company-a/companyinfo/company-a',
      { headers: { Authorization: 'Bearer at-1', Accept: 'application/json' } }
    );
  });

  it('uses the production host for a non-sandbox environment', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ CompanyInfo: { CompanyName: 'Acme Inc' } }),
    } as Response);

    const provider = new IntuitCompanyInfoProvider();
    await provider.fetchCompanyName({ accessToken: 'at-1', realmId: 'company-a', environment: 'production' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://quickbooks.api.intuit.com/v3/company/company-a/companyinfo/company-a',
      expect.anything()
    );
  });

  it('throws when QuickBooks responds with a non-OK status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);

    const provider = new IntuitCompanyInfoProvider();
    await expect(
      provider.fetchCompanyName({ accessToken: 'bad', realmId: 'company-a', environment: 'sandbox' })
    ).rejects.toThrow(/QuickBooks returned 401/);
  });

  it('throws when the response has no CompanyName', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ CompanyInfo: {} }) } as Response);

    const provider = new IntuitCompanyInfoProvider();
    await expect(
      provider.fetchCompanyName({ accessToken: 'at-1', realmId: 'company-a', environment: 'sandbox' })
    ).rejects.toThrow(/did not return a CompanyName/);
  });

  it('throws when the response has no CompanyInfo at all', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

    const provider = new IntuitCompanyInfoProvider();
    await expect(
      provider.fetchCompanyName({ accessToken: 'at-1', realmId: 'company-a', environment: 'sandbox' })
    ).rejects.toThrow(/did not return a CompanyName/);
  });
});
