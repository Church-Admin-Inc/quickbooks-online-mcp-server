import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockAuthorizeUri = jest.fn<(...args: unknown[]) => string>();
const mockCreateToken = jest.fn<(...args: unknown[]) => Promise<unknown>>();

class MockOAuthClient {
  static scopes = { Accounting: 'com.intuit.quickbooks.accounting' };
  constructor(public config: unknown) {}
  authorizeUri(opts: unknown) {
    return { toString: () => mockAuthorizeUri(this.config, opts) };
  }
  createToken(url: string) {
    return mockCreateToken(this.config, url);
  }
}

jest.unstable_mockModule('intuit-oauth', () => ({ default: MockOAuthClient }));

const { IntuitAccountingOAuthProvider } = await import(
  '../../../src/auth/intuit-accounting-authorization-provider.js'
);

describe('IntuitAccountingOAuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const loadConfig = jest.fn(() => ({ clientId: 'client-id', clientSecret: 'client-secret', environment: 'sandbox' }));
  const provider = new IntuitAccountingOAuthProvider(loadConfig);

  it('builds an authorization URL scoped to Accounting, loading config lazily', () => {
    mockAuthorizeUri.mockReturnValue('https://intuit.example/authorize?...');
    expect(loadConfig).not.toHaveBeenCalled();

    const url = provider.authorizationUrl({ redirectUri: 'https://qbo.example.com/auth/quickbooks/callback', state: 'company-state' });

    expect(url).toBe('https://intuit.example/authorize?...');
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeUri).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-id', redirectUri: 'https://qbo.example.com/auth/quickbooks/callback' }),
      { scope: ['com.intuit.quickbooks.accounting'], state: 'company-state' }
    );
  });

  it('exchanges a callback URL for a refresh token, access token, environment and the realm Intuit issued it for', async () => {
    mockCreateToken.mockResolvedValue({ token: { refresh_token: 'rt-1', realmId: 'company-a', access_token: 'at-1' } });

    const grant = await provider.exchangeCodeForGrant({
      callbackUrl: 'https://qbo.example.com/auth/quickbooks/callback?code=abc&realmId=company-a&state=s',
      redirectUri: 'https://qbo.example.com/auth/quickbooks/callback',
    });

    expect(grant).toEqual({ refreshToken: 'rt-1', realmId: 'company-a', accessToken: 'at-1', environment: 'sandbox' });
    expect(mockCreateToken).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'https://qbo.example.com/auth/quickbooks/callback' }),
      'https://qbo.example.com/auth/quickbooks/callback?code=abc&realmId=company-a&state=s'
    );
  });

  it('throws when Intuit does not return a refresh token, an access token, and a realm id', async () => {
    mockCreateToken.mockResolvedValue({ token: { refresh_token: 'rt-1' } });
    await expect(
      provider.exchangeCodeForGrant({ callbackUrl: 'https://x/cb?code=1', redirectUri: 'https://x/cb' })
    ).rejects.toThrow(/refresh token, an access token, and a realm id/);
  });

  it('throws when Intuit returns a refresh token and realm id but no access token', async () => {
    mockCreateToken.mockResolvedValue({ token: { refresh_token: 'rt-1', realmId: 'company-a' } });
    await expect(
      provider.exchangeCodeForGrant({ callbackUrl: 'https://x/cb?code=1', redirectUri: 'https://x/cb' })
    ).rejects.toThrow(/refresh token, an access token, and a realm id/);
  });
});
