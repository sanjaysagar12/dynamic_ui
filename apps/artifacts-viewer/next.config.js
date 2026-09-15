//@ts-check

const { join } = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Small, self-contained runtime image (.next/standalone) instead of
  // needing the full node_modules tree in the deployed container — see
  // apps/artifacts-viewer/Dockerfile.
  output: 'standalone',
  // This is an npm-workspaces monorepo — most deps (react, next itself,
  // etc.) are hoisted to the repo root's node_modules, not this app's own.
  // Without pointing the file tracer at the repo root, standalone output
  // would miss those hoisted packages and fail at runtime.
  outputFileTracingRoot: join(__dirname, '../../'),
};

module.exports = nextConfig;
