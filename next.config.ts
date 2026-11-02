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

/**
 * Browser CSP inventory and rollout notes: docs/audit/CSP-PREPARATION.md.
 * Report-Only only — do not flip to Content-Security-Policy without owner approval
 * after observing violations in a real browser session.
 */
const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net",
  "font-src 'self' data:",
  "connect-src 'self' https://discord.com https://oauth.battle.net",
  "form-action 'self' https://discord.com https://oauth.battle.net",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=15552000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy-Report-Only", value: CONTENT_SECURITY_POLICY_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  deploymentId: resolveDeploymentId(),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
