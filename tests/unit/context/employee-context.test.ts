/**
 * Behavioral tests for the ambient employee context (issue #6): the
 * mechanism the HTTP transport's bearer-token check uses to make the
 * authenticated employee's identity available to every tool call.
 */
import { jest } from '@jest/globals';

describe('employee-context', () => {
  it('returns undefined when no context is active', async () => {
    await jest.isolateModulesAsync(async () => {
      const { getCurrentEmployeeContext } = await import('../../../src/context/employee-context.js');
      expect(getCurrentEmployeeContext()).toBeUndefined();
    });
  });

  it('returns the active context within runWithEmployeeContext', async () => {
    await jest.isolateModulesAsync(async () => {
      const { getCurrentEmployeeContext, runWithEmployeeContext } = await import(
        '../../../src/context/employee-context.js'
      );

      const result = runWithEmployeeContext({ sub: 'abc', email: 'a@example.com' }, () =>
        getCurrentEmployeeContext()
      );

      expect(result).toEqual({ sub: 'abc', email: 'a@example.com' });
      // Outside the run() call, no context is active again.
      expect(getCurrentEmployeeContext()).toBeUndefined();
    });
  });

  it('propagates the active context across an await boundary', async () => {
    await jest.isolateModulesAsync(async () => {
      const { getCurrentEmployeeContext, runWithEmployeeContext } = await import(
        '../../../src/context/employee-context.js'
      );

      const result = await runWithEmployeeContext({ sub: 'xyz', email: 'b@example.com' }, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        return getCurrentEmployeeContext();
      });

      expect(result).toEqual({ sub: 'xyz', email: 'b@example.com' });
    });
  });
});
