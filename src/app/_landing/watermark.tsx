/** Faint oversized "BOOTH" text-texture watermark for the hero panel background. */
export function Watermark() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden"
    >
      <span
        className="font-display font-extrabold leading-none tracking-tighter text-cream/10"
        style={{ fontSize: "clamp(120px, 26vw, 340px)" }}
      >
        BOOTH
      </span>
    </div>
  );
}
