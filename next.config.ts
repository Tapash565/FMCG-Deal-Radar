import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The export renderers use Node-native libraries that ship their own CJS builds and
  // reach for Node built-ins (streams, zlib). Let them load via native require instead
  // of being pulled through the bundler, which is where they tend to break.
  serverExternalPackages: ['docx', 'exceljs', 'pptxgenjs'],

  // Two categories of files the serverless file tracer misses, forced into every server trace:
  //
  //  1. data/snapshot.json — loadSeed() reads it at runtime via a dynamic process.cwd() path
  //     the tracer can't follow, so on Vercel the seed fallback would ENOENT and blank the demo.
  //
  //  2. The CommonJS builds of the externalized OOXML libraries. Because these are in
  //     serverExternalPackages they load via native require() at runtime, which resolves the
  //     packages' `require` export condition — docx/dist/index.cjs and pptxgenjs/dist/pptxgen.cjs.js.
  //     But the tracer follows the `import` condition and only ships the .mjs builds, so on Vercel
  //     the CJS entry each package's require() actually targets is absent. The route imports both
  //     libs at module top, so the whole export function fails to initialize — every format 500s
  //     with a platform HTML page (before the handler's try/catch). Local dev has the full
  //     node_modules, so it only reproduces in production. (exceljs' main IS its require target,
  //     so it traces correctly and needs no help; jszip, the one shared runtime dep, is traced too.)
  outputFileTracingIncludes: {
    '/*': [
      './data/snapshot.json',
      './node_modules/docx/dist/**/*',
      './node_modules/pptxgenjs/dist/**/*',
    ],
  },
};

export default nextConfig;
