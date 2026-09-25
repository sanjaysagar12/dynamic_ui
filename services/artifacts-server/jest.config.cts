module.exports = {
  displayName: 'artifacts-server',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    // @org/shared-types transformed with its own dedicated transformer, not
    // ts-jest — see jest-transform-shared-types.cjs (mirrors tool-service's
    // own copy) for why.
    '^.+[\\\\/]packages[\\\\/]shared-types[\\\\/]src[\\\\/].+\\.ts$': '<rootDir>/jest-transform-shared-types.cjs',
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
  // @org/shared-types's package.json#exports resolves the bare "default"/"import" condition to
  // its built dist/index.js — real ESM (`export * from ...`), which Jest's CJS-mode require()
  // can't parse. This redirects the bare specifier straight to its TS source instead, so it goes
  // through the transform above rather than being require()'d as-is.
  moduleNameMapper: {
    '^@org/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
  },
};
