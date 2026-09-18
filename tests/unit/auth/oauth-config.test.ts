import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  loadOAuthConfig,
  loadIntuitFederationConfig,
  OAuthConfigError,
} from '../../../src/auth/oauth-config.js';

describe('loadOAuthConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.MCP_OAUTH_REDIRECT_URIS;
    delete process.env.MCP_OAUTH_CLIENT_ID;
    delete process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws a config error when MCP_OAUTH_REDIRECT_URIS is unset', () => {
    expect(() => loadOAuthConfig()).toThrow(OAuthConfigError);
  });

  it('parses a single redirect URI and applies defaults', () => {
    process.env.MCP_OAUTH_REDIRECT_URIS = 'https://claude.ai/api/mcp/auth_callback';
    expect(loadOAuthConfig()).toEqual({
      claudeClientId: 'claude-ai',
      claudeRedirectUris: ['https://claude.ai/api/mcp/auth_callback'],
      accessTokenTtlSeconds: 3600,
    });
  });

  it('parses multiple comma-separated redirect URIs, trimming whitespace', () => {
    process.env.MCP_OAUTH_REDIRECT_URIS = ' https://a.example/cb , https://b.example/cb ';
    expect(loadOAuthConfig().claudeRedirectUris).toEqual(['https://a.example/cb', 'https://b.example/cb']);
  });

  it('honors an explicit client id and access token TTL', () => {
    process.env.MCP_OAUTH_REDIRECT_URIS = 'https://claude.ai/cb';
    process.env.MCP_OAUTH_CLIENT_ID = 'custom-client';
    process.env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS = '120';

    const config = loadOAuthConfig();
    expect(config.claudeClientId).toBe('custom-client');
    expect(config.accessTokenTtlSeconds).toBe(120);
  });
});

describe('loadIntuitFederationConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when QUICKBOOKS_CLIENT_ID or QUICKBOOKS_CLIENT_SECRET is missing', () => {
    process.env.QUICKBOOKS_CLIENT_ID = '';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'secret';
    expect(() => loadIntuitFederationConfig()).toThrow(OAuthConfigError);
  });

  it('defaults environment to sandbox and reads the Intuit app credentials', () => {
    process.env.QUICKBOOKS_CLIENT_ID = 'id';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'secret';
    delete process.env.QUICKBOOKS_ENVIRONMENT;

    expect(loadIntuitFederationConfig()).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      environment: 'sandbox',
    });
  });

  it('honors an explicit QUICKBOOKS_ENVIRONMENT', () => {
    process.env.QUICKBOOKS_CLIENT_ID = 'id';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'secret';
    process.env.QUICKBOOKS_ENVIRONMENT = 'production';

    expect(loadIntuitFederationConfig().environment).toBe('production');
  });
});
