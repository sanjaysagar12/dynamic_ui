//@ts-check

const { join } = require('path');

// prisma/schema.prisma generates the client to a custom local path (see that
// file's top-of-file note) rather than the default `@prisma/client`. Prisma
// gives every custom-output client its own synthetic package name (a
// package.json alongside the generated code — see
// src/generated/prisma-client/package.json) specifically so bundlers can
// externalize it. Without that below, Next's build bundles/traces this
// client's code into a server chunk, which corrupts the __dirname-relative
// lookup its native query-engine binary loader depends on — the client
// starts hunting for libquery_engine-*.so.node in doubled/wrong paths at
// runtime (PrismaClientInitializationError: "could not locate the Query
// Engine") even though `prisma generate` produced it correctly on disk.
// Externalizing leaves this require() untouched by the bundler, so Node's
// normal module resolution (and therefore __dirname) stays correct.
let generatedPrismaClientPkgName;
try {
  generatedPrismaClientPkgName = require('./src/generated/prisma-client/package.json').name;
} catch {
  // Not generated yet (e.g. `next dev`/`next build` run before
  // `npm run db:generate` — see README.md). Next.js will still bundle the
  // client in this case and hit the same engine-not-found error above;
  // this only prevents next.config.js itself from crashing before that.
}

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
  ...(generatedPrismaClientPkgName && {
    serverExternalPackages: [generatedPrismaClientPkgName],
  }),
  // /db-chat and /chat were real routes before the workspace shell (design.md
  // §11) merged everything into the single state-driven `/` page — redirect
  // anyone with an old URL bookmarked instead of leaving them at a 404.
  async redirects() {
    return [
      { source: '/db-chat', destination: '/', permanent: false },
      { source: '/chat', destination: '/', permanent: false },
    ];
  },
};

module.exports = nextConfig;
