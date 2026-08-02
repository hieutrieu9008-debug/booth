"use client";

import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { scanPayload, type ScanOutcome } from "./actions";

/**
 * Compact camera pane (SPEC-WSB-F.md WS-F item 1, "F1 — One screen"): the
 * camera used to be its own full-height "Scan" tab; it now lives capped at
 * ~42vh (spec budget: <=45vh) with the phone-lookup pane directly beneath it
 * in the same viewport, and a single shared result panel one level up in
 * ScanScreen (./scan-screen.tsx) rather than owning its own. Camera config
 * unchanged from the proven M1 spike (src/app/dev/scan-spike/scan-client.tsx):
 * qr-scanner, rear camera, highlighted scan region, 10 scans/sec cap.
 */
export function CameraPane({ slug, onResult }: { slug: string; onResult: (outcome: ScanOutcome) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const lastRef = useRef<{ data: string; ts: number }>({ data: "", ts: 0 });
  const processingRef = useRef(false);

  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    async function onDecode(scanResult: QrScanner.ScanResult) {
      const data = scanResult.data;
      const now = performance.now();
      // Same de-dupe idiom as the M1 spike: qr-scanner re-fires the same
      // code many times a second — ignore repeats within 3s so a held-up
      // code doesn't double-submit while the staffer is still reading the
      // result panel.
      if (processingRef.current) return;
      if (data === lastRef.current.data && now - lastRef.current.ts < 3000) return;
      lastRef.current = { data, ts: now };
      processingRef.current = true;
      try {
        const outcome = await scanPayload(slug, data);
        onResult(outcome);
      } finally {
        processingRef.current = false;
      }
    }

    const scanner = new QrScanner(video, onDecode, {
      returnDetailedScanResult: true,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      preferredCamera: "environment",
      maxScansPerSecond: 10,
    });
    scannerRef.current = scanner;
    scanner
      .start()
      .then(async () => setHasFlash(await scanner.hasFlash()))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      scanner.destroy();
      scannerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function toggleFlash() {
    const scanner = scannerRef.current;
    if (!scanner) return;
    await scanner.toggleFlash();
    setFlashOn(scanner.isFlashOn());
  }

  return (
    <div className="relative h-[42vh] shrink-0 overflow-hidden bg-ink">
      <video ref={videoRef} className="h-full w-full object-cover" />

      {hasFlash && (
        <button
          onClick={toggleFlash}
          className={`absolute right-4 top-4 min-h-11 min-w-11 rounded-button px-4 font-display font-bold ${
            flashOn ? "bg-butter text-ink" : "bg-ink/80 text-cream"
          }`}
        >
          {flashOn ? "Torch on" : "Torch"}
        </button>
      )}

      {error && (
        <p className="absolute inset-x-4 top-4 rounded-button bg-coral-dark px-3 py-2 text-sm font-semibold text-cream">
          Camera error: {error}
        </p>
      )}
    </div>
  );
}
