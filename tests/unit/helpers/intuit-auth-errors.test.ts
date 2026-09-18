import { describe, it, expect } from '@jest/globals';
import { isAuthInvalidationError } from '../../../src/helpers/intuit-auth-errors';

describe('isAuthInvalidationError', () => {
  it('treats a 400 embedded in an axios-style message as a dead token', () => {
    expect(isAuthInvalidationError(new Error('Request failed with status code 400'))).toBe(true);
  });

  it('treats a 401 embedded in an axios-style message as a dead token', () => {
    expect(isAuthInvalidationError(new Error('Request failed with status code 401'))).toBe(true);
  });

  it('does not treat a 3-digit prefix of a 4-digit number as a status code match', () => {
    expect(isAuthInvalidationError(new Error('Request failed with status code 4001'))).toBe(false);
  });

  it('treats a 5xx as transient, not a dead token', () => {
    expect(isAuthInvalidationError(new Error('Request failed with status code 503'))).toBe(false);
  });

  it('treats a 429 as transient, not a dead token', () => {
    expect(isAuthInvalidationError(new Error('Request failed with status code 429'))).toBe(false);
  });

  it('treats a network error with no status code as transient', () => {
    expect(isAuthInvalidationError(new Error('getaddrinfo ETIMEDOUT oauth.platform.intuit.com'))).toBe(false);
  });

  it('treats an explicit error field containing invalid_grant as a dead token', () => {
    expect(isAuthInvalidationError({ error: 'invalid_grant' })).toBe(true);
  });

  it('treats an explicit error_description field containing invalid_grant as a dead token', () => {
    expect(isAuthInvalidationError({ error_description: 'Token invalid_grant or expired' })).toBe(true);
  });

  it('treats invalid_grant appearing directly in the message as a dead token', () => {
    expect(isAuthInvalidationError(new Error('invalid_grant'))).toBe(true);
  });

  it('reads status from authResponse.status as a function', () => {
    expect(isAuthInvalidationError({ authResponse: { status: () => 400 } })).toBe(true);
  });

  it('ignores an authResponse.status function that returns a non-numeric value, falling back to message parsing', () => {
    const err = Object.assign(new Error('Request failed with status code 400'), {
      authResponse: { status: () => undefined },
    });
    expect(isAuthInvalidationError(err)).toBe(true);
  });

  it('ignores an authResponse.status function that throws, falling back to message parsing', () => {
    const err = Object.assign(new Error('Request failed with status code 401'), {
      authResponse: {
        status: () => {
          throw new Error('accessor exploded');
        },
      },
    });
    expect(isAuthInvalidationError(err)).toBe(true);
  });

  it('reads status from authResponse.status as a plain number', () => {
    expect(isAuthInvalidationError({ authResponse: { status: 401 } })).toBe(true);
  });

  it('reads status from authResponse.response.status when authResponse.status is absent', () => {
    expect(isAuthInvalidationError({ authResponse: { response: { status: 400 } } })).toBe(true);
  });

  it('reads a top-level numeric status field when no authResponse is present', () => {
    expect(isAuthInvalidationError({ status: 401 })).toBe(true);
  });

  it('returns false for a non-object, non-Error raw value', () => {
    expect(isAuthInvalidationError('just a string')).toBe(false);
    expect(isAuthInvalidationError(null)).toBe(false);
    expect(isAuthInvalidationError(undefined)).toBe(false);
    expect(isAuthInvalidationError(42)).toBe(false);
  });

  it('walks a bounded cause chain to find the real signal', () => {
    const outer = Object.assign(new Error('wrapper'), {
      cause: Object.assign(new Error('inner wrapper'), {
        cause: new Error('Request failed with status code 400'),
      }),
    });
    expect(isAuthInvalidationError(outer)).toBe(true);
  });

  it('gives up after a bounded number of cause hops without finding a signal', () => {
    // 5 levels deep exceeds the 4-hop bound, so the real signal at the bottom
    // is never reached.
    let deepest: unknown = new Error('Request failed with status code 400');
    for (let i = 0; i < 5; i++) {
      deepest = Object.assign(new Error(`wrapper ${i}`), { cause: deepest });
    }
    expect(isAuthInvalidationError(deepest)).toBe(false);
  });

  it('stops traversing when a cause chain ends in null', () => {
    const err = Object.assign(new Error('wrapper'), { cause: null });
    expect(isAuthInvalidationError(err)).toBe(false);
  });
});
