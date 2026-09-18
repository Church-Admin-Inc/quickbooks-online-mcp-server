/**
 * Covers issue #6 (OAuth protected resource with Intuit-federated employee
 * identity) at the HTTP application seam, the same level as
 * streamable-http-application.test.ts: the real HTTP server, routing, and
 * OAuth endpoints all run for real. Only the Intuit half of the flow is
 * faked, via a fake IntuitIdentityProvider injected the same way
 * registerTools is injected — no network call, no real Intuit app needed.
 */
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IntuitIdentity, IntuitIdentityProvider } from '../../src/auth/intuit-identity-provider';

const { createStreamableHttpServer, MCP_HTTP_PATH } = await import('../../src/http/create-streamable-http-server');
const { OAuthStore } = await import('../../src/auth/oauth-store');
const { getCurrentEmployeeContext } = await import('../../src/context/employee-context');
const { protectedResourceMetadataPath, AUTHORIZATION_SERVER_METADATA_PATH } = await import(
  '../../src/auth/oauth-metadata'
);

const CLAUDE_REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const FAKE_IDENTITY: IntuitIdentity = { sub: 'intuit-sub-1', email: 'employee@example.com' };

class FakeIntuitIdentityProvider implements IntuitIdentityProvider {
  exchangeShouldFail = false;

  authorizationUrl(params: { redirectUri: string; state: string }): string {
    return `https://fake-intuit.example/authorize?redirect_uri=${encodeURIComponent(params.redirectUri)}&state=${params.state}`;
  }

  async exchangeCodeForIdentity(): Promise<IntuitIdentity> {
    if (this.exchangeShouldFail) throw new Error('Intuit denied the request');
    return FAKE_IDENTITY;
  }
}

function registerIdentityEchoTool(server: McpServer): void {
  server.tool('echo_identity', 'Test-only: echoes the ambient employee context', { params: z.object({}) }, async () => {
    const identity = getCurrentEmployeeContext();
    return { content: [{ type: 'text' as const, text: JSON.stringify(identity ?? null) }] };
  });
}

async function listen(server: http.Server): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}`);
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('OAuth-protected streamable HTTP application', () => {
  let server: http.Server;
  let identityProvider: FakeIntuitIdentityProvider;

  beforeEach(() => {
    identityProvider = new FakeIntuitIdentityProvider();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  async function startServer(): Promise<URL> {
    server = createStreamableHttpServer(registerIdentityEchoTool, {
      oauth: {
        store: new OAuthStore(),
        identityProvider,
        loadConfig: () => ({
          claudeClientId: 'claude-ai',
          claudeRedirectUris: [CLAUDE_REDIRECT_URI],
          accessTokenTtlSeconds: 3600,
        }),
      },
    });
    return listen(server);
  }

  async function authorize(base: URL, params: Record<string, string>): Promise<Response> {
    const url = new URL('/authorize', base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return fetch(url, { redirect: 'manual' });
  }

  /** Drives /authorize through to a claude.ai authorization code, using the fake Intuit identity provider. */
  async function obtainAuthorizationCode(
    base: URL,
    challenge: string,
    state: string | undefined
  ): Promise<{ code: string; claudeState: string | null }> {
    const authorizeResponse = await authorize(base, {
      client_id: 'claude-ai',
      redirect_uri: CLAUDE_REDIRECT_URI,
      response_type: 'code',
      ...(state ? { state } : {}),
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(authorizeResponse.status).toBe(302);
    const intuitUrl = new URL(authorizeResponse.headers.get('location')!);
    const loginState = intuitUrl.searchParams.get('state')!;
    expect(loginState).toBeTruthy();

    const callbackUrl = new URL('/auth/intuit/callback', base);
    callbackUrl.searchParams.set('code', 'intuit-auth-code');
    callbackUrl.searchParams.set('state', loginState);
    const callbackResponse = await fetch(callbackUrl, { redirect: 'manual' });
    expect(callbackResponse.status).toBe(302);
    const claudeRedirect = new URL(callbackResponse.headers.get('location')!);
    expect(claudeRedirect.origin + claudeRedirect.pathname).toBe(CLAUDE_REDIRECT_URI);

    return { code: claudeRedirect.searchParams.get('code')!, claudeState: claudeRedirect.searchParams.get('state')! };
  }

  it('rejects an unauthenticated MCP request with 401 and a WWW-Authenticate pointing at protected-resource metadata', async () => {
    const base = await startServer();
    const response = await fetch(new URL(MCP_HTTP_PATH, base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

    expect(response.status).toBe(401);
    const header = response.headers.get('www-authenticate');
    expect(header).toContain('Bearer');
    expect(header).toContain(`resource_metadata="${base.origin}${protectedResourceMetadataPath(MCP_HTTP_PATH)}"`);
  });

  it('rejects a request with a malformed Authorization header the same way as a missing one', async () => {
    const base = await startServer();
    const response = await fetch(new URL(MCP_HTTP_PATH, base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Basic not-a-bearer-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a request bearing an unknown access token', async () => {
    const base = await startServer();
    const response = await fetch(new URL(MCP_HTTP_PATH, base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer not-a-real-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  it('serves protected-resource metadata naming the resource exactly, including path', async () => {
    const base = await startServer();
    const response = await fetch(new URL(protectedResourceMetadataPath(MCP_HTTP_PATH), base));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe(`${base.origin}${MCP_HTTP_PATH}`);
    expect(body.authorization_servers).toEqual([base.origin]);
  });

  it('serves authorization-server metadata advertising PKCE S256', async () => {
    const base = await startServer();
    const response = await fetch(new URL(AUTHORIZATION_SERVER_METADATA_PATH, base));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { code_challenge_methods_supported: string[]; issuer: string };
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
    expect(body.issuer).toBe(base.origin);
  });

  it('rejects an unknown client_id at /authorize', async () => {
    const base = await startServer();
    const response = await authorize(base, {
      client_id: 'someone-else',
      redirect_uri: CLAUDE_REDIRECT_URI,
      response_type: 'code',
      code_challenge: 'x',
      code_challenge_method: 'S256',
    });
    expect(response.status).toBe(400);
  });

  it('rejects an unregistered redirect_uri at /authorize without redirecting to it (no open redirect)', async () => {
    const base = await startServer();
    const response = await authorize(base, {
      client_id: 'claude-ai',
      redirect_uri: 'https://attacker.example/cb',
      response_type: 'code',
      code_challenge: 'x',
      code_challenge_method: 'S256',
    });
    expect(response.status).toBe(400);
  });

  it('requires PKCE S256, redirecting back to the client with an error otherwise', async () => {
    const base = await startServer();
    const response = await authorize(base, {
      client_id: 'claude-ai',
      redirect_uri: CLAUDE_REDIRECT_URI,
      response_type: 'code',
      state: 'claude-state',
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(CLAUDE_REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('claude-state');
  });

  it('requires PKCE S256 even when the client sent no state', async () => {
    const base = await startServer();
    const response = await authorize(base, {
      client_id: 'claude-ai',
      redirect_uri: CLAUDE_REDIRECT_URI,
      response_type: 'code',
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.has('state')).toBe(false);
  });

  it('redirects with unsupported_response_type for a non-code response_type', async () => {
    const base = await startServer();
    const response = await authorize(base, {
      client_id: 'claude-ai',
      redirect_uri: CLAUDE_REDIRECT_URI,
      response_type: 'token',
      code_challenge: 'x',
      code_challenge_method: 'S256',
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('unsupported_response_type');
  });

  it('redirects with unsupported_response_type, preserving state when the client sent one', async () => {
    const base = await startServer();
    const response = await authorize(base, {
      client_id: 'claude-ai',
      redirect_uri: CLAUDE_REDIRECT_URI,
      response_type: 'token',
      state: 'claude-state',
      code_challenge: 'x',
      code_challenge_method: 'S256',
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('unsupported_response_type');
    expect(location.searchParams.get('state')).toBe('claude-state');
  });

  it('rejects an Intuit callback with no state at all', async () => {
    const base = await startServer();
    const response = await fetch(new URL('/auth/intuit/callback', base));
    expect(response.status).toBe(400);
  });

  it('rejects an Intuit callback with an unknown or expired login state', async () => {
    const base = await startServer();
    const callbackUrl = new URL('/auth/intuit/callback', base);
    callbackUrl.searchParams.set('code', 'whatever');
    callbackUrl.searchParams.set('state', 'not-a-real-state');
    const response = await fetch(callbackUrl);
    expect(response.status).toBe(400);
  });

  it('surfaces a failed Intuit identity exchange by redirecting back to the client with access_denied', async () => {
    const base = await startServer();
    identityProvider.exchangeShouldFail = true;
    const { challenge } = pkce();

    const authorizeResponse = await authorize(base, {
      client_id: 'claude-ai',
      redirect_uri: CLAUDE_REDIRECT_URI,
      response_type: 'code',
      state: 'claude-state',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const intuitUrl = new URL(authorizeResponse.headers.get('location')!);
    const loginState = intuitUrl.searchParams.get('state')!;

    const callbackUrl = new URL('/auth/intuit/callback', base);
    callbackUrl.searchParams.set('code', 'whatever');
    callbackUrl.searchParams.set('state', loginState);
    const callbackResponse = await fetch(callbackUrl, { redirect: 'manual' });

    expect(callbackResponse.status).toBe(302);
    const location = new URL(callbackResponse.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(CLAUDE_REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('claude-state');
  });

  it('surfaces a failed Intuit identity exchange without a state param when the client sent none', async () => {
    const base = await startServer();
    identityProvider.exchangeShouldFail = true;
    const { challenge } = pkce();

    const authorizeResponse = await authorize(base, {
      client_id: 'claude-ai',
      redirect_uri: CLAUDE_REDIRECT_URI,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const intuitUrl = new URL(authorizeResponse.headers.get('location')!);
    const loginState = intuitUrl.searchParams.get('state')!;

    const callbackUrl = new URL('/auth/intuit/callback', base);
    callbackUrl.searchParams.set('code', 'whatever');
    callbackUrl.searchParams.set('state', loginState);
    const callbackResponse = await fetch(callbackUrl, { redirect: 'manual' });

    expect(callbackResponse.status).toBe(302);
    const location = new URL(callbackResponse.headers.get('location')!);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.has('state')).toBe(false);
  });

  it('rejects a token request that is not the authorization_code grant', async () => {
    const base = await startServer();
    const response = await fetch(new URL('/token', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('unsupported_grant_type');
  });

  it('rejects a token request missing required parameters', async () => {
    const base = await startServer();
    const response = await fetch(new URL('/token', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code' }).toString(),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a token request for an unknown authorization code', async () => {
    const base = await startServer();
    const response = await fetch(new URL('/token', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'not-a-real-code',
        redirect_uri: CLAUDE_REDIRECT_URI,
        client_id: 'claude-ai',
        code_verifier: 'anything',
      }).toString(),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a token exchange whose code_verifier does not match the code_challenge', async () => {
    const base = await startServer();
    const { challenge } = pkce();
    const { code } = await obtainAuthorizationCode(base, challenge, 'claude-state');

    const response = await fetch(new URL('/token', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CLAUDE_REDIRECT_URI,
        client_id: 'claude-ai',
        code_verifier: 'the-wrong-verifier',
      }).toString(),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('completes the full federated login, token exchange (form-encoded), and authenticated tool call', async () => {
    const base = await startServer();
    const { verifier, challenge } = pkce();
    const { code, claudeState } = await obtainAuthorizationCode(base, challenge, 'claude-state');
    expect(claudeState).toBe('claude-state');

    const tokenResponse = await fetch(new URL('/token', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CLAUDE_REDIRECT_URI,
        client_id: 'claude-ai',
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenResponse.status).toBe(200);
    const tokenBody = (await tokenResponse.json()) as { access_token: string; token_type: string; expires_in: number };
    expect(tokenBody.token_type).toBe('Bearer');
    expect(typeof tokenBody.access_token).toBe('string');
    expect(tokenBody.expires_in).toBe(3600);

    // The authorization code is single-use (RFC 6749 §4.1.2).
    const replay = await fetch(new URL('/token', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CLAUDE_REDIRECT_URI,
        client_id: 'claude-ai',
        code_verifier: verifier,
      }).toString(),
    });
    expect(replay.status).toBe(400);

    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_HTTP_PATH, base), {
      requestInit: { headers: { Authorization: `Bearer ${tokenBody.access_token}` } },
    });

    await client.connect(transport);
    try {
      const result = await client.callTool({ name: 'echo_identity', arguments: { params: {} } });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content[0]?.text ?? 'null')).toEqual(FAKE_IDENTITY);
    } finally {
      await client.close();
    }
  });

  it('completes the login flow without a state param, when the client sent none', async () => {
    const base = await startServer();
    const { challenge } = pkce();
    const { code, claudeState } = await obtainAuthorizationCode(base, challenge, undefined);
    expect(claudeState).toBeNull();
    expect(code).toBeTruthy();
  });
});
