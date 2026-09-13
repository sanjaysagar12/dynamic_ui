// Shared across test/infra/testApp.ts (signs the app's verifier with this
// secret) and test/infra/testUser.ts (signs tokens with the same secret) —
// a single constant so the two can never drift apart into signing/verifying
// with different secrets.
export const TEST_JWT_SECRET = 'test-jwt-secret-layer2-do-not-use-in-prod';
