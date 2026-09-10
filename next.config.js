/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a QA build/start run alongside `next dev` without sharing `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Self-contained server bundle for the Docker image (see Dockerfile): only
  // the files the app actually imports are copied into .next/standalone.
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    // These packages use dynamic/CJS `require` patterns (pdf-parse's debug branch,
    // mammoth's binary parsing, playwright's native browser launcher, Prisma's
    // generated query engine binary) that break if webpack tries to bundle them.
    // Externalizing keeps them as real Node `require()`s at runtime instead.
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth', 'playwright', 'playwright-core', '@prisma/client']
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // `playwright` is an *optional* dependency, and the production image
      // installs with `npm ci --omit=optional` (see Dockerfile) because the
      // headless-browser SERP fallback is not used in production — recruiters
      // supply a SerpAPI key instead. Without this, webpack still tries to
      // resolve the lazy `await import('playwright')` in
      // src/lib/search/playwrightSearch.ts while building the module graph and
      // fails with "Module not found: Can't resolve 'playwright'", even though
      // that import never executes at build time. `serverComponentsExternalPackages`
      // above is not enough on its own, since Next still resolves those
      // packages on disk to trace them for the standalone output.
      //
      // Marking them external leaves the import as a runtime require. When the
      // package is absent it throws exactly where both callers already catch it
      // (playwrightSearch.ts logs and returns no results; serp.ts records the
      // message), so a search degrades to `provider: 'none'` rather than
      // breaking the build.
      config.externals = [...(config.externals ?? []), 'playwright', 'playwright-core'];
    }
    return config;
  }
};

module.exports = nextConfig;
