/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a QA build/start run alongside `next dev` without sharing `.next`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  experimental: {
    // These packages use dynamic/CJS `require` patterns (pdf-parse's debug branch,
    // mammoth's binary parsing, playwright's native browser launcher, Prisma's
    // generated query engine binary) that break if webpack tries to bundle them.
    // Externalizing keeps them as real Node `require()`s at runtime instead.
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth', 'playwright', 'playwright-core', '@prisma/client']
  }
};

module.exports = nextConfig;
