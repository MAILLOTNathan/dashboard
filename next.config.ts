import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The container image runs the standalone server output; a local build keeps
  // the standard output so that `npm run build && npm start` works as expected.
  // Set by the Dockerfile, never by hand.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Route Handlers, authentication and PostgreSQL access must stay enabled.
  // Do not replace this with `output: "export"`: a static export cannot serve them.
};

export default nextConfig;
