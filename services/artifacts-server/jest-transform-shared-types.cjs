// @org/shared-types (packages/shared-types) is an ESM package ("type":
// "module", tsconfig.base.json's "module": "nodenext"), so ts-jest's
// normal config-discovery machinery — even pointed at that package's own
// tsconfig — keeps resolving "nodenext" for it and emitting genuine ESM
// `export`/`import` syntax, which Jest's CJS runtime can't execute. This
// bypasses ts-jest's own config resolution entirely and calls the
// TypeScript compiler API directly with an explicit, self-contained
// CommonJS compilerOptions object — no "extends", nothing to resolve.
const ts = require('typescript');
const crypto = require('node:crypto');

module.exports = {
  process(sourceText, sourcePath) {
    const result = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: false,
        sourceMap: true,
        inlineSourceMap: true,
      },
    });
    return { code: result.outputText };
  },
  getCacheKey(sourceText, sourcePath) {
    return crypto.createHash('sha1').update(sourceText).update(sourcePath).digest('hex');
  },
};
