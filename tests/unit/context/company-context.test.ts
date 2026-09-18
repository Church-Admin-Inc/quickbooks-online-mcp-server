/**
 * Behavioral tests for the ambient Company context: the mechanism ticket #2
 * introduces so QuickbooksClient can resolve the Company for a request from
 * an AsyncLocalStorage context rather than closing over module state.
 */
import { jest } from '@jest/globals';

describe('company-context', () => {
  it('throws when no context is active and no default has been configured', async () => {
    await jest.isolateModulesAsync(async () => {
      const { getCurrentCompanyContext } = await import('../../../src/context/company-context.js');
      expect(() => getCurrentCompanyContext()).toThrow(/No Company context is active/);
    });
  });

  it('falls back to the process-wide default when no context is active', async () => {
    await jest.isolateModulesAsync(async () => {
      const { getCurrentCompanyContext, setDefaultCompanyContext } = await import(
        '../../../src/context/company-context.js'
      );
      setDefaultCompanyContext({ realmId: 'default-realm' });
      expect(getCurrentCompanyContext()).toEqual({ realmId: 'default-realm' });
    });
  });

  it('prefers an explicitly active context over the default', async () => {
    await jest.isolateModulesAsync(async () => {
      const { getCurrentCompanyContext, setDefaultCompanyContext, runWithCompanyContext } = await import(
        '../../../src/context/company-context.js'
      );
      setDefaultCompanyContext({ realmId: 'default-realm' });

      const result = runWithCompanyContext({ realmId: 'active-realm' }, () => getCurrentCompanyContext());

      expect(result).toEqual({ realmId: 'active-realm' });
      // The default is unaffected outside the run() call.
      expect(getCurrentCompanyContext()).toEqual({ realmId: 'default-realm' });
    });
  });

  it('propagates the active context across an await boundary', async () => {
    await jest.isolateModulesAsync(async () => {
      const { getCurrentCompanyContext, runWithCompanyContext } = await import(
        '../../../src/context/company-context.js'
      );

      const result = await runWithCompanyContext({ realmId: 'async-realm' }, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return getCurrentCompanyContext();
      });

      expect(result).toEqual({ realmId: 'async-realm' });
    });
  });
});
