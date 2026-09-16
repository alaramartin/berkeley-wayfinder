import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@wf/schema", "@wf/geometry", "@wf/routing"],
};

export default config;
