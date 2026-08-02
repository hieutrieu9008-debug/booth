export type WaveDividerProps = {
  /** CSS color for the wave fill — pass a v4 token, e.g. "var(--paper)" or "var(--coral)", matching the section it flows INTO. */
  fill: string;
  /** Flips the curve vertically, for use at the top vs. bottom of a section. */
  flip?: boolean;
  className?: string;
};

/** Organic curved section transition (DESIGN.md's "waves, not borders" doctrine) — no hard stacked blocks between sections. */
export function WaveDivider({ fill, flip = false, className = "" }: WaveDividerProps) {
  return (
    <div className={`w-full overflow-hidden leading-none ${flip ? "rotate-180" : ""} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 1440 120" preserveAspectRatio="none" className="block h-16 w-full sm:h-24">
        <path d="M0,64 C240,120 480,0 720,32 C960,64 1200,112 1440,48 L1440,120 L0,120 Z" fill={fill} />
      </svg>
    </div>
  );
}
