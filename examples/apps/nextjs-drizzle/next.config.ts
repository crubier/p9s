import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The root of the monorepo, whose lockfile has the workspace packages
  turbopack: { root: path.join(__dirname, "../../..") },
};

export default nextConfig;
