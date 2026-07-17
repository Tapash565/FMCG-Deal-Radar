import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The export renderers use Node-native libraries that ship their own CJS builds and
  // reach for Node built-ins (streams, zlib). Let them load via native require instead
  // of being pulled through the bundler, which is where they tend to break.
  serverExternalPackages: ['docx', 'exceljs', 'pptxgenjs'],

  // loadSeed() reads data/snapshot.json at runtime via a dynamic process.cwd() path, which
  // the serverless file tracer can't follow — so on Vercel the file would be missing and
  // the seed fallback would ENOENT, blanking the demo. Force it into every server bundle.
  outputFileTracingIncludes: {
    '/*': ['./data/snapshot.json'],
  },
};

export default nextConfig;
