import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockAuthorizeUri = jest.fn<(...args: unknown[]) => string>();
const mockCreateToken = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetUserInfo = jest.fn<(...args: unknown[]) => Promise<{ json?: Record<string, unknown> }>>();

class MockOAuthClient {
  static scopes = { OpenId: 'openid', Email: 'email', Profile: 'profile', Accounting: 'com.intuit.quickbooks.accounting' };
  constructor(public config: unknown) {}
  authorizeUri(opts: unknown) {
    return { toString: () => mockAuthorizeUri(this.config, opts) };
  }
  createToken(url: string) {
    return mockCreateToken(this.config, url);
  }
  getUserInfo() {
    return mockGetUserInfo();
  }
}

jest.unstable_mockModule('intuit-oauth', () => ({ default: MockOAuthClient }));

const { IntuitOpenIdIdentityProvider } = await import('../../../src/auth/intuit-identity-provider.js');

describe('IntuitOpenIdIdentityProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const provider = new IntuitOpenIdIdentityProvider({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    environment: 'sandbox',
  });

  it('builds an authorization URL scoped to openid, email, and profile', () => {
    mockAuthorizeUri.mockReturnValue('https://intuit.example/authorize?...');

    const url = provider.authorizationUrl({ redirectUri: 'https://qbo.example.com/auth/intuit/callback', state: 'login-state' });

    expect(url).toBe('https://intuit.example/authorize?...');
    expect(mockAuthorizeUri).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-id', redirectUri: 'https://qbo.example.com/auth/intuit/callback' }),
      { scope: ['openid', 'email', 'profile'], state: 'login-state' }
    );
  });

  it('exchanges a callback URL for the employee identity', async () => {
    mockCreateToken.mockResolvedValue(undefined);
    mockGetUserInfo.mockResolvedValue({ json: { sub: 'intuit-sub-1', email: 'employee@example.com' } });

    const identity = await provider.exchangeCodeForIdentity({
      callbackUrl: 'https://qbo.example.com/auth/intuit/callback?code=abc&state=login-state',
      redirectUri: 'https://qbo.example.com/auth/intuit/callback',
    });

    expect(identity).toEqual({ sub: 'intuit-sub-1', email: 'employee@example.com' });
    expect(mockCreateToken).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: 'https://qbo.example.com/auth/intuit/callback' }),
      'https://qbo.example.com/auth/intuit/callback?code=abc&state=login-state'
    );
  });

  it('throws when Intuit does not return both sub and email', async () => {
    mockCreateToken.mockResolvedValue(undefined);
    mockGetUserInfo.mockResolvedValue({ json: { sub: 'intuit-sub-1' } });

    await expect(
      provider.exchangeCodeForIdentity({ callbackUrl: 'https://x/cb?code=1', redirectUri: 'https://x/cb' })
    ).rejects.toThrow(/sub and email/);
  });

  it('throws when Intuit returns no claims at all', async () => {
    mockCreateToken.mockResolvedValue(undefined);
    mockGetUserInfo.mockResolvedValue({});

    await expect(
      provider.exchangeCodeForIdentity({ callbackUrl: 'https://x/cb?code=1', redirectUri: 'https://x/cb' })
    ).rejects.toThrow(/sub and email/);
  });
});
