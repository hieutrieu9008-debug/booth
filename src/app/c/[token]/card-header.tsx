"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Full QR up top (scrolls with the page); a compact sticky mini-bar fades in
 * once the full QR scrolls out of view (SPEC-WS2 §Member card 1) — never a
 * half-screen sticky block. Tapping the mini-bar scrolls back to the full QR.
 * WS-E item 4: the phone-fallback line sits directly under the QR in both
 * states, and tapping either QR opens an enlarged dialog (dim-room test —
 * DESIGN.md — a diner squinting at a small phone needs a bigger code fast).
 */
export function MemberCardHeader({
  restaurantName,
  brandColor,
  memberFirstName,
  qrDataUrl,
  backupPhone,
  initialCollapsed = false,
}: {
  restaurantName: string;
  brandColor: string;
  memberFirstName: string;
  qrDataUrl: string;
  /** National-format phone, shown as the "no scanner? staff can look you up" fallback directly under the QR. */
  backupPhone: string;
  /** QA-only (never set outside dev): forces the collapsed mini-bar to render without a real scroll, since headless screenshot tooling can't scroll. See /c/[token]?qa=scrolled. */
  initialCollapsed?: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLDivElement>(null);
  const enlargeRef = useRef<HTMLDialogElement>(null);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        aria-hidden={!collapsed}
        className={`fixed inset-x-0 top-0 z-20 border-b-2 border-line bg-cream transition-transform duration-200 ease-out ${
          collapsed ? "translate-y-0" : "-translate-y-full pointer-events-none"
        }`}
      >
        <button
          type="button"
          onClick={() => enlargeRef.current?.showModal()}
          className="mx-auto flex w-full max-w-md items-center gap-3 px-6 py-2.5 text-left"
        >
          <img src={qrDataUrl} width={40} height={40} alt="" aria-hidden="true" className="block h-10 w-10 rounded border-2 border-ink" />
          <span className="flex-1">
            <span className="block font-display text-sm font-bold">{restaurantName}</span>
            <span className="block text-xs text-muted">Tap to enlarge · staff can look up {backupPhone}</span>
          </span>
          <span aria-label="Restaurant brand colour" className="h-2.5 w-2.5 shrink-0 rounded-full border border-ink" style={{ backgroundColor: brandColor }} />
        </button>
      </div>

      {/* QA-only: the initialCollapsed preview hides the full header so the mini-bar screenshot approximates a real scrolled position without faking scroll physics. */}
      <header ref={fullRef} className={`border-b-2 border-line bg-cream px-6 py-6 ${initialCollapsed ? "hidden" : ""}`}>
        <div className="mx-auto max-w-md">
          <div className="flex items-center gap-2">
            <p className="font-display text-base font-bold">{restaurantName}</p>
            <span aria-label="Restaurant brand colour" className="h-2.5 w-2.5 rounded-full border border-ink" style={{ backgroundColor: brandColor }} />
          </div>
          <h1 className="mt-1 font-display text-3xl font-extrabold">{memberFirstName}&apos;s card</h1>
          <button
            type="button"
            onClick={() => enlargeRef.current?.showModal()}
            aria-label="Enlarge your rewards code"
            className="mx-auto mt-5 block w-fit rounded-card border-2 border-ink bg-white p-3 shadow-punch"
          >
            <img src={qrDataUrl} width={220} height={220} alt="Member rewards QR code" className="block h-[220px] w-[220px]" />
          </button>
          <p className="mt-5 text-center text-lg font-semibold">Show this to stamp your visit.</p>
          <p className="mt-1 text-center text-sm text-muted">No scanner? Staff can look you up by {backupPhone}.</p>
          <div ref={sentinelRef} aria-hidden="true" />
        </div>
      </header>

      <dialog
        ref={enlargeRef}
        onClick={(e) => {
          if (e.target === enlargeRef.current) enlargeRef.current?.close();
        }}
        className="m-auto w-[min(92vw,420px)] rounded-card border-2 border-ink bg-paper p-0 shadow-punch backdrop:bg-ink/50"
      >
        <div className="relative p-6 text-center">
          <button
            type="button"
            aria-label="Close"
            onClick={() => enlargeRef.current?.close()}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-cream font-display text-lg font-bold"
          >
            ×
          </button>
          <img src={qrDataUrl} width={320} height={320} alt="Member rewards QR code, enlarged" className="mx-auto mt-8 block h-[min(70vh,320px)] w-[min(70vh,320px)]" />
          <p className="mt-5 text-lg font-semibold">Show this to stamp your visit.</p>
          <p className="mt-1 text-sm text-muted">No scanner? Staff can look you up by {backupPhone}.</p>
        </div>
      </dialog>
    </>
  );
}
