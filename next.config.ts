import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // argon2 and the pg driver are native/node-only; keep them out of the bundler.
  serverExternalPackages: ["@node-rs/argon2", "@prisma/adapter-pg", "pg"],
  // There is an unrelated package-lock.json in the home directory, which makes
  // Next guess the wrong workspace root. Pin it to this project.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
