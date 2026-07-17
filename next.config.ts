import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // docx and exceljs are Node-native OOXML libraries kept out of the bundle so they load from
  // node_modules at runtime. Both resolve cleanly when externalized: docx is "type":"module"
  // with a valid .mjs `import` entry, and exceljs is plain CommonJS (its package `main` is the
  // require target). pptxgenjs is deliberately NOT in this list — see the note below.
  serverExternalPackages: ['docx', 'exceljs'],

  // Why pptxgenjs must be BUNDLED, not externalized:
  // Next/Turbopack loads a serverExternalPackages entry at runtime via ESM import(), which
  // resolves the package's `import` export condition. pptxgenjs@4 maps that to
  // dist/pptxgen.es.js — a file full of `import`/`export` statements in a package that is NOT
  // "type":"module" — so on Vercel Node throws "Cannot use import statement outside a module"
  // and the whole export route fails to initialize. Because route.ts imports every renderer at
  // module top, that one bad load 500s all five formats (docx, pptx, xlsx, csv, json). Leaving
  // pptxgenjs in the default bundle lets Turbopack transpile its ESM build at build time, so the
  // broken runtime-resolution path never runs. (Local dev/`next start` use the full node_modules
  // and a different module path, which is why this only ever reproduced in production.)

  // Files the serverless file tracer misses, forced into every server trace:
  //  - data/snapshot.json: loadSeed() reads it at runtime via a dynamic process.cwd() path the
  //    tracer can't follow, so on Vercel the seed fallback would ENOENT and blank the demo.
  //  - docx/dist: insurance for the externalized docx build's runtime files.
  outputFileTracingIncludes: {
    '/*': [
      './data/snapshot.json',
      './node_modules/docx/dist/**/*',
    ],
  },
};

export default nextConfig;
