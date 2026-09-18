/**
 * Covers createStreamableHttpServer()'s DEFAULT options path (no `options`
 * argument at all, and no `oauth` override) — everything else about this
 * module is covered behaviorally in
 * tests/integration/streamable-http-application.test.ts and
 * tests/integration/oauth-http-application.test.ts, which always inject an
 * `oauth` override to avoid depending on real Intuit credentials.
 */
import { jest, describe, it, expect, afterEach } from '@jest/globals';

describe('createStreamableHttpServer defaults', () => {
  afterEach(() => {
    delete process.env.MCP_OAUTH_REDIRECT_URIS;
    delete process.env.QUICKBOOKS_CLIENT_ID;
    delete process.env.QUICKBOOKS_CLIENT_SECRET;
  });

  it('builds a real OAuth server from env vars when no options are passed at all', async () => {
    await jest.isolateModulesAsync(async () => {
      process.env.MCP_OAUTH_REDIRECT_URIS = 'https://claude.ai/api/mcp/auth_callback';
      process.env.QUICKBOOKS_CLIENT_ID = 'test-client-id';
      process.env.QUICKBOOKS_CLIENT_SECRET = 'test-client-secret';

      const { createStreamableHttpServer } = await import('../../../src/http/create-streamable-http-server.js');
      const server = createStreamableHttpServer(() => {});
      expect(server.listening).toBe(false);
      server.close();
    });
  });
});
