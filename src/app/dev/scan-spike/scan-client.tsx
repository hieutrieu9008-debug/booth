"use client";

import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import QRCode from "qrcode";

const SELF_TEST_PAYLOAD = "bl:selftest:0f3a9c81d2e64b7a";

type LogEntry = {
  data: string;
  at: string; // wall clock HH:MM:SS
  sinceStartMs: number;
};

type EnvInfo = {
  userAgent: string;
  secureContext: boolean;
  barcodeDetector: boolean;
  hasCamera: boolean | null;
};

export function ScanSpikeClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const startTsRef = useRef(0);
  const lastSeenRef = useRef<{ data: string; ts: number }>({ data: "", ts: 0 });

  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [firstDecodeMs, setFirstDecodeMs] = useState<number | null>(null);
  const [cameras, setCameras] = useState<QrScanner.Camera[]>([]);
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [selfTest, setSelfTest] = useState<string | null>(null);

  useEffect(() => {
    QrScanner.hasCamera().then((hasCamera) =>
      setEnv({
        userAgent: navigator.userAgent,
        secureContext: window.isSecureContext,
        barcodeDetector: "BarcodeDetector" in window,
        hasCamera,
      }),
    );
    return () => {
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, []);

  function onDecode(result: QrScanner.ScanResult) {
    const now = performance.now();
    const last = lastSeenRef.current;
    // qr-scanner re-fires the same code many times per second; log a code at
    // most once per 1.5s so the log reflects distinct scan events.
    if (result.data === last.data && now - last.ts < 1500) return;
    lastSeenRef.current = { data: result.data, ts: now };

    const sinceStartMs = Math.round(now - startTsRef.current);
    setFirstDecodeMs((prev) => prev ?? sinceStartMs);
    setLogs((prev) =>
      [
        {
          data: result.data,
          at: new Date().toLocaleTimeString(),
          sinceStartMs,
        },
        ...prev,
      ].slice(0, 30),
    );
    if (navigator.vibrate) navigator.vibrate(60);
  }

  async function start() {
    setError(null);
    setFirstDecodeMs(null);
    const video = videoRef.current;
    if (!video) return;
    try {
      const scanner = new QrScanner(video, onDecode, {
        returnDetailedScanResult: true,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        preferredCamera: "environment",
        maxScansPerSecond: 10,
      });
      scannerRef.current = scanner;
      startTsRef.current = performance.now();
      await scanner.start();
      setRunning(true);
      setCameras(await QrScanner.listCameras(true));
      setHasFlash(await scanner.hasFlash());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      scannerRef.current?.destroy();
      scannerRef.current = null;
    }
  }

  function stop() {
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setRunning(false);
    setFlashOn(false);
  }

  async function switchCamera(id: string) {
    await scannerRef.current?.setCamera(id);
    setHasFlash((await scannerRef.current?.hasFlash()) ?? false);
    setFlashOn(false);
  }

  async function toggleFlash() {
    const scanner = scannerRef.current;
    if (!scanner) return;
    await scanner.toggleFlash();
    setFlashOn(scanner.isFlashOn());
  }

  async function runSelfTest() {
    setSelfTest("running…");
    try {
      const dataUrl = await QRCode.toDataURL(SELF_TEST_PAYLOAD, {
        width: 300,
        errorCorrectionLevel: "M",
      });
      const t0 = performance.now();
      const result = await QrScanner.scanImage(dataUrl, {
        returnDetailedScanResult: true,
      });
      const ms = Math.round(performance.now() - t0);
      setSelfTest(
        result.data === SELF_TEST_PAYLOAD
          ? `PASS — decoded in ${ms}ms`
          : `FAIL — decoded wrong payload: ${result.data}`,
      );
    } catch (e) {
      setSelfTest(`FAIL — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">
          Camera scan spike
        </h1>
        <p className="mt-1 text-sm text-muted">
          M1 — prove browser QR scanning on this phone. Point the camera at a
          code from the{" "}
          <a href="/dev/scan-spike/codes" className="underline">
            test codes page
          </a>
          .
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border-soft bg-ink">
        <video ref={videoRef} className="aspect-[3/4] w-full object-cover" />
      </div>

      <div className="flex gap-3">
        {!running ? (
          <button
            onClick={start}
            className="min-h-12 flex-1 rounded-lg bg-coral px-4 font-semibold text-cream"
          >
            Start camera
          </button>
        ) : (
          <button
            onClick={stop}
            className="min-h-12 flex-1 rounded-lg border border-border-soft bg-paper px-4 font-semibold text-ink"
          >
            Stop
          </button>
        )}
        {running && hasFlash && (
          <button
            onClick={toggleFlash}
            className={`min-h-12 rounded-lg border border-border-soft px-4 font-semibold ${
              flashOn ? "bg-butter text-ink" : "bg-paper text-ink"
            }`}
          >
            {flashOn ? "Torch on" : "Torch"}
          </button>
        )}
      </div>

      {running && cameras.length > 1 && (
        <select
          onChange={(e) => switchCamera(e.target.value)}
          className="min-h-11 rounded-lg border border-border-soft bg-paper px-3 text-ink"
          defaultValue=""
        >
          <option value="" disabled>
            Switch camera…
          </option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label || c.id}
            </option>
          ))}
        </select>
      )}

      {error && (
        <p className="rounded-lg bg-peach px-3 py-2 text-sm font-semibold text-coral-dark">
          Camera error: {error}
        </p>
      )}

      <div className="rounded-xl border border-border-soft bg-paper p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display font-bold text-ink">Scan log</h2>
          {firstDecodeMs !== null && (
            <span className="text-xs text-muted">
              first decode {(firstDecodeMs / 1000).toFixed(1)}s after start
            </span>
          )}
        </div>
        {logs.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing scanned yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {logs.map((l, i) => (
              <li key={i} className="break-all font-mono text-xs text-ink">
                <span className="text-muted">{l.at}</span> {l.data}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border-soft bg-paper p-4">
        <h2 className="font-display font-bold text-ink">
          Decoder self-test (no camera)
        </h2>
        <p className="mt-1 text-sm text-muted">
          Generates a QR in memory and decodes it — proves the decode pipeline
          works in this browser.
        </p>
        <button
          onClick={runSelfTest}
          className="mt-3 min-h-11 rounded-lg border border-border-soft bg-paper px-4 font-semibold text-ink"
        >
          Run self-test
        </button>
        {selfTest && (
          <p
            className={`mt-2 font-mono text-sm ${
              selfTest.startsWith("PASS") ? "text-ink" : "text-coral-dark"
            }`}
          >
            {selfTest}
          </p>
        )}
      </div>

      {env && (
        <div className="rounded-xl border border-border-soft bg-paper p-4 text-xs text-muted">
          <h2 className="font-display text-sm font-bold text-ink">
            Environment
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            <li>Secure context (HTTPS): {env.secureContext ? "yes" : "NO — camera will not work"}</li>
            <li>
              Native BarcodeDetector: {env.barcodeDetector ? "yes" : "no (worker fallback)"}
            </li>
            <li>Camera present: {env.hasCamera === null ? "?" : env.hasCamera ? "yes" : "NO"}</li>
            <li className="break-all">UA: {env.userAgent}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
