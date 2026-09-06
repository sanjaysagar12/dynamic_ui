module.exports = {
  displayName: 'tool-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
  // DB-backed tests (test/) start a real Testcontainers Postgres per file —
  // container pull/start/migrate routinely exceeds Jest's 5s default.
  testTimeout: 60000,
};
