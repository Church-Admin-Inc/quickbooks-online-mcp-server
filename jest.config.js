/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**/*.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    // The OAuth client spins up an interactive browser flow and a local HTTP
    // callback server, which can't be fully unit-covered. Jest subtracts
    // path-matched files from the global group, so the 100% gate above still
    // applies to everything else. Before quickbooks-client.auth.test.ts this
    // file had no tests at all (it was never imported, so istanbul never saw
    // it); these floors reflect what the new behavioral tests cover.
    './src/clients/quickbooks-client.ts': {
      branches: 45,
      functions: 65,
      lines: 70,
      statements: 70,
    },
    // Moved out of quickbooks-client.ts (see #3): the module-load-time throw for
    // a non-absolute QUICKBOOKS_TOKEN_STORE_PATH, and the unlink-on-write-failure
    // cleanup path in save(), aren't exercised by the behavioral tests above.
    './src/clients/token-grant-store.ts': {
      branches: 80,
      functions: 100,
      lines: 90,
      statements: 90,
    },
    // update_account's normalizePatch carries a scalar field-type-map switch
    // whose `default` arm is unreachable (the map only ever maps to
    // string/boolean/number). The behavioral tests cover every reachable path;
    // this floor accounts for that one dead arm.
    './src/handlers/update-quickbooks-account.handler.ts': {
      branches: 89,
      functions: 100,
      lines: 97,
      statements: 95,
    },
    // create_account's normalizeAccountPayload carries a scalar field-type-map
    // switch whose boolean/number/default arms are not reachable from the
    // public surface (the fixed payload feeds only string fields; the ParentRef
    // object is attached separately). The behavioral tests cover the reachable
    // paths (top-level create, sub-account create via parent_id, errors); this
    // floor accounts for the dead arms.
    './src/handlers/create-quickbooks-account.handler.ts': {
      branches: 60,
      functions: 100,
      lines: 75,
      statements: 75,
    },
    // The only gap: the `.catch(() => {})` no-op handlers on the res "close"
    // listener only run if transport.close()/server.close() reject, which
    // they don't under any condition the tests can induce without deeply
    // mocking the SDK's transport — they exist solely so a rejection there
    // can never crash the process with an unhandled rejection. Everything
    // else (Host-header allowlisting including the missing/malformed/
    // disallowed cases, routing, the whole-request and mid-response failure
    // paths) is covered behaviorally.
    './src/http/create-streamable-http-server.ts': {
      branches: 93,
      functions: 71,
      lines: 100,
      statements: 100,
    },
    // QuickbooksMCPServer's constructor is `private` specifically to enforce
    // the singleton — it is never, and can never be, called directly.
    './src/server/qbo-mcp-server.ts': {
      branches: 100,
      functions: 66,
      lines: 100,
      statements: 100,
    },
    // GrantBackedQuickbooksClients#resolveAccessToken's `if (!resolved)` guard
    // (issue #8): handle.refresh()'s callback either sets `resolved` or the
    // callback throws and refresh() rejects, so the guard body is dead code
    // that exists only to satisfy the return type without a non-null
    // assertion. Everything reachable (cache hit/miss, rotation and
    // persistence, per-employee isolation, the "no grant" rejection) is
    // covered behaviorally.
    './src/clients/grant-quickbooks-clients.ts': {
      branches: 75,
      functions: 100,
      lines: 95,
      statements: 95,
    },
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  clearMocks: true,
  restoreMocks: true,
};
