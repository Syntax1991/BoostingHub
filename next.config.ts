import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * Version-skew protection: a deployment identifier per production build (the
 * deployed commit), so a browser tab still running the previous build is
 * hard-reloaded on its next navigation instead of calling the new server with
 * old client code (server action IDs stay stable across builds).
 */
function resolveDeploymentId(): string | undefined {
  if (process.env.NEXT_DEPLOYMENT_ID) return process.env.NEXT_DEPLOYMENT_ID;
  if (process.env.NODE_ENV !== "production") return undefined;
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

const nextConfig: NextConfig = {
  deploymentId: resolveDeploymentId(),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
    ],
  },
};

export default nextConfig;
