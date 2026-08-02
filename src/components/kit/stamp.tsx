import type { HTMLAttributes, ReactNode } from "react";

type StampTone = "butter" | "cream";
type StampShape = "circle" | "pill";

export type StampProps = {
  tone?: StampTone;
  shape?: StampShape;
  /** Rotation in degrees. DESIGN.md's playful annotation devices default to a slight -6deg tilt. */
  rotate?: number;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children">;

const toneClasses: Record<StampTone, string> = {
  butter: "bg-butter",
  cream: "bg-cream",
};

const shapeClasses: Record<StampShape, string> = {
  circle: "aspect-square h-20 w-20 flex-col text-center",
  pill: "px-4 py-2",
};

/** Playful rotated annotation badge (DESIGN.md) — a stamp/sticker overlay, not a status chip. */
export function Stamp({ tone = "butter", shape = "pill", rotate = -6, className = "", children, ...rest }: StampProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-display text-sm font-bold text-ink ${toneClasses[tone]} ${shapeClasses[shape]} ${className}`}
      style={{ transform: `rotate(${rotate}deg)` }}
      {...rest}
    >
      {children}
    </span>
  );
}
