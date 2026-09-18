import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { OAuthStore } from '../../../src/auth/oauth-store.js';

describe('OAuthStore', () => {
  let store: OAuthStore;

  beforeEach(() => {
    store = new OAuthStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('pending logins', () => {
    it('returns and single-uses a pending login', () => {
      const state = store.createPendingLogin(
        { claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', claudeState: 's1', codeChallenge: 'cc' },
        600
      );

      const first = store.consumePendingLogin(state);
      expect(first).toEqual({
        claudeClientId: 'claude-ai',
        claudeRedirectUri: 'https://claude.ai/cb',
        claudeState: 's1',
        codeChallenge: 'cc',
        expiresAt: expect.any(Number),
      });

      expect(store.consumePendingLogin(state)).toBeUndefined();
    });

    it('returns undefined for an unknown login state', () => {
      expect(store.consumePendingLogin('nope')).toBeUndefined();
    });

    it('returns undefined for an expired pending login', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      const state = store.createPendingLogin(
        { claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', claudeState: undefined, codeChallenge: 'cc' },
        1
      );
      nowSpy.mockReturnValue(1_000_000 + 2000);

      expect(store.consumePendingLogin(state)).toBeUndefined();
    });
  });

  describe('authorization codes', () => {
    const identity = { sub: 'sub-1', email: 'employee@example.com' };

    it('peeks a fresh code without consuming it, then can mark it used', () => {
      const code = store.issueAuthorizationCode(
        { identity, claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', codeChallenge: 'cc' },
        60
      );

      expect(store.peekAuthorizationCode(code)).toMatchObject({ identity, claudeClientId: 'claude-ai' });
      // Peeking again still finds it — not yet consumed.
      expect(store.peekAuthorizationCode(code)).toMatchObject({ identity });

      store.markAuthorizationCodeUsed(code);
      expect(store.peekAuthorizationCode(code)).toBeUndefined();
    });

    it('returns undefined for an unknown code', () => {
      expect(store.peekAuthorizationCode('nope')).toBeUndefined();
    });

    it('is a no-op marking an unknown code as used', () => {
      expect(() => store.markAuthorizationCodeUsed('nope')).not.toThrow();
    });

    it('returns undefined for an expired code', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      const code = store.issueAuthorizationCode(
        { identity, claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', codeChallenge: 'cc' },
        1
      );
      nowSpy.mockReturnValue(1_000_000 + 2000);

      expect(store.peekAuthorizationCode(code)).toBeUndefined();
    });
  });

  describe('sweepExpired (unbounded-growth mitigation)', () => {
    const identity = { sub: 'sub-1', email: 'employee@example.com' };

    it('drops an abandoned pending login on a later write but keeps one still live at sweep time', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      store.createPendingLogin(
        { claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', claudeState: undefined, codeChallenge: 'expiring' },
        1
      );

      // Still fresh at this point: the sweep this write triggers must keep it.
      nowSpy.mockReturnValue(1_000_000 + 500);
      store.createPendingLogin(
        { claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', claudeState: undefined, codeChallenge: 'fresh' },
        600
      );
      expect(store.sizes().pendingLogins).toBe(2);

      // Now the first one has expired; this write's sweep must drop it and keep the second.
      nowSpy.mockReturnValue(1_000_000 + 5000);
      store.createPendingLogin(
        { claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', claudeState: undefined, codeChallenge: 'newest' },
        600
      );
      expect(store.sizes().pendingLogins).toBe(2);
    });

    it('drops an expired, unredeemed authorization code but keeps one still live at sweep time', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      store.issueAuthorizationCode(
        { identity, claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', codeChallenge: 'expiring' },
        1
      );

      nowSpy.mockReturnValue(1_000_000 + 500);
      store.issueAuthorizationCode(
        { identity, claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', codeChallenge: 'fresh' },
        60
      );
      expect(store.sizes().authorizationCodes).toBe(2);

      nowSpy.mockReturnValue(1_000_000 + 5000);
      store.issueAuthorizationCode(
        { identity, claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', codeChallenge: 'newest' },
        60
      );
      expect(store.sizes().authorizationCodes).toBe(2);
    });

    it('drops a used authorization code on the next write, independent of its expiry', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      const usedCode = store.issueAuthorizationCode(
        { identity, claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', codeChallenge: 'will-be-used' },
        600
      );
      store.markAuthorizationCodeUsed(usedCode);
      expect(store.sizes().authorizationCodes).toBe(1);

      store.issueAuthorizationCode(
        { identity, claudeClientId: 'claude-ai', claudeRedirectUri: 'https://claude.ai/cb', codeChallenge: 'trigger-sweep' },
        600
      );
      // The used code is gone even though it hasn't expired; the new one remains.
      expect(store.sizes().authorizationCodes).toBe(1);
    });

    it('drops an expired access token but keeps one still live at sweep time', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      store.issueAccessToken(identity, 1);

      nowSpy.mockReturnValue(1_000_000 + 500);
      store.issueAccessToken(identity, 3600);
      expect(store.sizes().accessTokens).toBe(2);

      nowSpy.mockReturnValue(1_000_000 + 5000);
      store.issueAccessToken(identity, 3600);
      expect(store.sizes().accessTokens).toBe(2);
    });
  });

  describe('access tokens', () => {
    const identity = { sub: 'sub-1', email: 'employee@example.com' };

    it('resolves a freshly issued token to its identity', () => {
      const { token, expiresIn } = store.issueAccessToken(identity, 3600);
      expect(expiresIn).toBe(3600);
      expect(store.resolveAccessToken(token)).toEqual(identity);
    });

    it('returns undefined for an unknown token', () => {
      expect(store.resolveAccessToken('nope')).toBeUndefined();
    });

    it('returns undefined for an expired token', () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      const { token } = store.issueAccessToken(identity, 1);
      nowSpy.mockReturnValue(1_000_000 + 2000);

      expect(store.resolveAccessToken(token)).toBeUndefined();
    });
  });
});
