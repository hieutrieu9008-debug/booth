import type { Metadata } from "next";
import QRCode from "qrcode";

export const metadata: Metadata = {
  title: "Test QR codes — Booth Loyalty dev",
  robots: { index: false, follow: false },
};

// Realistic payload lengths: member QR is a short identity token; reward QR is
// a longer one-use signed token. Length drives QR density, which drives how
// small a code can be and still scan in a dim room.
const PAYLOADS = [
  { label: "Member QR (short token)", data: "bl:m:7Kq2mXv9pRt4wZn8" },
  {
    label: "Reward QR (signed one-use token)",
    data: "bl:r:eyJnIjoiZ3JhbnRfOWYzYTJiIiwibSI6Im1lbV83a3EybXh2IiwiZXhwIjoxNzg0NTA1NjAwfQ.4f8c1d9e2a7b3c6d",
  },
];

const SIZES_CM = [2, 3, 4];

export default async function TestCodesPage() {
  const groups = await Promise.all(
    PAYLOADS.map(async (p) => ({
      ...p,
      dataUrl: await QRCode.toDataURL(p.data, {
        width: 480,
        margin: 2,
        errorCorrectionLevel: "M",
      }),
    })),
  );

  return (
    <main className="min-h-dvh bg-white px-6 py-8 text-ink">
      <h1 className="font-display text-2xl font-bold">Test QR codes</h1>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Scan these from the <a href="/dev/scan-spike" className="underline">spike scanner</a> —
        off-screen and printed. Print at 100% scale for true physical sizes.
        PRD dim-room standard: flat, high contrast, ≥3cm.
      </p>
      {groups.map((g) => (
        <section key={g.label} className="mt-8">
          <h2 className="font-display font-bold">{g.label}</h2>
          <p className="break-all font-mono text-xs text-muted">{g.data}</p>
          <div className="mt-3 flex flex-wrap items-end gap-8">
            {SIZES_CM.map((cm) => (
              <figure key={cm}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.dataUrl}
                  alt={`${g.label} at ${cm}cm`}
                  style={{ width: `${cm}cm`, height: `${cm}cm` }}
                />
                <figcaption className="mt-1 text-center text-xs text-muted">
                  {cm}cm
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
