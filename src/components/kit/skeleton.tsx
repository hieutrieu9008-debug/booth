export type SkeletonProps = {
  variant?: "block" | "line";
  className?: string;
};

/** Loading placeholder — pulse block only, never a spinner (DESIGN.md hard ban). */
export function Skeleton({ variant = "block", className = "" }: SkeletonProps) {
  const shape = variant === "line" ? "h-4 rounded-pill" : "h-32 rounded-card";
  return <div className={`animate-pulse bg-peach/60 ${shape} ${className}`} aria-hidden="true" />;
}
