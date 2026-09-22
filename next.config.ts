import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["yjs", "y-protocols", "y-indexeddb", "lib0", "y-codemirror.next"],
};

export default nextConfig;
