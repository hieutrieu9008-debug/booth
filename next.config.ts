import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DEMO_NOINDEX=1 is set ONLY on a temporary demo deployment. The
  // X-Robots-Tag header wins over per-page metadata
  // robots (several pages set index:true), which is exactly why it lives here
  // and not in layout metadata. Must NOT be set on real launch infra.
  async headers() {
    if (!process.env.DEMO_NOINDEX) return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
