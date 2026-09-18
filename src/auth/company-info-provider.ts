/**
 * Looks up a Company's human-readable QuickBooks name (issue #9's
 * `list_companies`) using the access token minted by the same Accounting-scope
 * exchange that just produced its refresh token (see
 * ../auth/intuit-accounting-authorization-provider.ts) — so authorization
 * needs no second token round-trip just to learn the Company's name. Called
 * once, at grant-creation time (../http/company-oauth-http.ts), and the
 * result is stored on the grant (see ../clients/firestore-grant-store.ts)
 * rather than looked up again on every `list_companies` call: a later lookup
 * would fail for exactly the Companies whose health we most want to report
 * (an unhealthy connection can no longer be asked).
 */
export interface CompanyInfoProvider {
  fetchCompanyName(params: { accessToken: string; realmId: string; environment: string }): Promise<string>;
}

interface CompanyInfoResponse {
  CompanyInfo?: { CompanyName?: string };
}

export class IntuitCompanyInfoProvider implements CompanyInfoProvider {
  async fetchCompanyName(params: { accessToken: string; realmId: string; environment: string }): Promise<string> {
    const host = params.environment === "sandbox" ? "sandbox-quickbooks.api.intuit.com" : "quickbooks.api.intuit.com";
    const url = `https://${host}/v3/company/${params.realmId}/companyinfo/${params.realmId}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${params.accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`QuickBooks returned ${response.status} fetching CompanyInfo for realm "${params.realmId}"`);
    }

    const body = (await response.json()) as CompanyInfoResponse;
    const name = body.CompanyInfo?.CompanyName;
    if (!name) {
      throw new Error(`QuickBooks did not return a CompanyName for realm "${params.realmId}"`);
    }
    return name;
  }
}
