import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@wf/schema", "@wf/geometry", "@wf/routing", "@wf/field"],
};

export default config;
