import type { NextConfig } from "next";

/* ============================================================
 *  Security headers — production/global-ready hardening.
 *  FRAME_ANCESTORS env: "self" (strict, recommended in production)
 *  or "self-https" (default — allows the hosting preview iframe).
 * ============================================================ */
function frameAncestors(): string {
  const mode = (process.env.FRAME_ANCESTORS || "self-https").toLowerCase();
  if (mode === "self") return "'self'";
  if (mode === "none") return "'none'";
  return "'self' https:";
}

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: isProd ? "SAMEORIGIN" : "ALLOWALL" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  /* HSTS only in production — never poison a shared dev/preview domain. */
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js hydration scripts + dev HMR (dev needs unsafe-eval)
      `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      // thumbnails from YouTube + QR/data + remote media mirrors
      "img-src 'self' data: blob: https://i.ytimg.com https://files.catbox.moe",
      // media streams: own /e/ route + remote mirrors (http+https hosts)
      "media-src 'self' blob: https: http:",
      "connect-src 'self'",
      // inline preview of the source video
      "frame-src https://www.youtube-nocookie.com",
      `frame-ancestors ${frameAncestors()}`,
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "worker-src 'self' blob:",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  /* No standalone output — keeps the repo portable: `next start` works
   * locally and Vercel uses its own serverless runtime anyway. */
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
