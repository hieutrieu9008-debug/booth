import type { HTMLAttributes, ReactNode } from "react";

type CardBg = "white" | "paper";
type CardRadius = "sm" | "md" | "lg";

export type CardProps = {
  bg?: CardBg;
  /** Radius scale per DESIGN.md's 16-24px card range. Default "md" = 20px. */
  radius?: CardRadius;
  /** Punch shadow elevation — opt-in, the only elevation strategy in this system. */
  shadow?: boolean;
  /** Ink hairline border. */
  border?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">;

const bgClasses: Record<CardBg, string> = {
  white: "bg-white",
  paper: "bg-paper",
};

const radiusClasses: Record<CardRadius, string> = {
  sm: "rounded-card-sm",
  md: "rounded-card",
  lg: "rounded-card-lg",
};

export function Card({
  bg = "white",
  radius = "md",
  shadow = false,
  border = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const classes = [
    bgClasses[bg],
    radiusClasses[radius],
    "p-6",
    shadow ? "shadow-punch" : "",
    border ? "border-2 border-ink" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
