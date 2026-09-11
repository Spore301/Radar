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
      // `playwright` is an *optional* dependency: the headless-browser SERP
      // fallback is not used in production, where recruiters supply a SerpAPI
      // key, and the production image ships no browser (see Dockerfile).
      // Marking it external keeps the lazy `await import('playwright')` in
      // src/lib/search/playwrightSearch.ts out of the bundle and out of the
      // standalone trace, so its presence or absence at build time never
      // matters. At runtime the require either works (dev, with a browser) or
      // throws exactly where both callers already catch it (playwrightSearch.ts
      // logs and returns no results; serp.ts records the message), and a search
      // degrades to `provider: 'none'`.
      config.externals = [...(config.externals ?? []), 'playwright', 'playwright-core'];
    }
    return config;
  }
};

module.exports = nextConfig;
