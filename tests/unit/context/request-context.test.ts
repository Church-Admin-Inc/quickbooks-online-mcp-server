import { describe, it, expect } from '@jest/globals';
import { runWithRequestContext, getCurrentRequestContext } from '../../../src/context/request-context';

describe('request-context', () => {
  it('is undefined outside any runWithRequestContext() call', () => {
    expect(getCurrentRequestContext()).toBeUndefined();
  });

  it('exposes the active origin for the whole async chain, scoped to the call', async () => {
    const seen = await runWithRequestContext({ origin: 'https://qbo.example.com' }, async () => {
      await Promise.resolve();
      return getCurrentRequestContext();
    });
    expect(seen).toEqual({ origin: 'https://qbo.example.com' });
    expect(getCurrentRequestContext()).toBeUndefined();
  });
});
