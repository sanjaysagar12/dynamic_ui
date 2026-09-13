module.exports = {
  displayName: 'tool-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    // @org/shared-types transformed with its own dedicated transformer, not
    // ts-jest — see jest-transform-shared-types.cjs for why.
    '^.+[\\\\/]packages[\\\\/]shared-types[\\\\/]src[\\\\/].+\\.ts$': '<rootDir>/jest-transform-shared-types.cjs',
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
  // DB-backed tests (test/) start a real Testcontainers Postgres per file —
  // container pull/start/migrate routinely exceeds Jest's 5s default.
  testTimeout: 60000,
  // Layer 2 (test/tools, test/http) is the first suite here importing src/,
  // which transitively imports @org/shared-types (src/tools/plugins/
  // register.ts). That package's package.json#exports resolves the bare
  // "default"/"import" condition to its built dist/index.js — real ESM
  // (`export * from ...`), which Jest's CJS-mode require() can't parse.
  // This redirects the bare specifier straight to its TS source instead, so
  // it goes through a transform (below) rather than being require()'d as-is.
  moduleNameMapper: {
    '^@org/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
  },
};
