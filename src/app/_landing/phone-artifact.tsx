/**
 * The hero's approved product artifact (DESIGN.md "Landing hero spec"): a
 * realistic iOS-style iMessage frame, CSS/SVG-built so it stays crisp at
 * retina. Non-interactive — decorative only, aria-hidden.
 */
export function PhoneArtifact() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none mx-auto w-[260px] rotate-[-3deg] select-none sm:w-[300px]"
    >
      {/* Device body */}
      <div className="rounded-[46px] border-[3px] border-ink bg-ink p-2 shadow-punch">
        {/* Screen */}
        <div className="relative overflow-hidden rounded-[36px] bg-[#f2f2f2]">
          {/* Dynamic island */}
          <div className="absolute left-1/2 top-3 z-10 h-[22px] w-[92px] -translate-x-1/2 rounded-full bg-ink" />

          {/* Status bar */}
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold text-ink">
            <span>7:42</span>
            <span className="tracking-tight">●●●●●</span>
          </div>

          {/* Message header */}
          <div className="flex flex-col items-center gap-1 border-b border-black/5 px-6 pb-3 pt-2">
            <div className="h-9 w-9 rounded-full bg-[#c7c7cc]" />
            <span className="text-[11px] font-semibold text-ink">Demo Kitchen</span>
          </div>

          {/* Message thread */}
          <div className="flex min-h-[300px] flex-col justify-end gap-1.5 px-4 py-5">
            <div className="max-w-[86%] rounded-2xl rounded-bl-md bg-[#e5e5ea] px-3.5 py-2.5 text-[13px] leading-snug text-ink">
              Demo Kitchen: you&apos;ve earned a free dessert. It&apos;s on your card — show it at the till. Reply
              STOP to opt out.
            </div>
            <span className="mt-1 self-center text-[10px] font-medium text-[#8e8e93]">7:42 pm</span>
          </div>

          {/* Home indicator */}
          <div className="flex justify-center pb-2 pt-3">
            <div className="h-1 w-28 rounded-full bg-ink/70" />
          </div>
        </div>
      </div>
    </div>
  );
}
