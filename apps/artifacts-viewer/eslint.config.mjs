import nextEslintPluginNext from '@next/eslint-plugin-next';
import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  { plugins: { '@next/next': nextEslintPluginNext } },
  ...nx.configs['flat/react-typescript'],
  ...baseConfig,
  {
    // src/generated/prisma-client is vendored/generated code (custom Prisma
    // client output — see prisma/schema.prisma), not hand-written source.
    ignores: ['.next/**/*', '**/out-tsc', 'src/generated/**'],
  },
];
