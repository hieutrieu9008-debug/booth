import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

type SharedProps = {
  variant?: Variant;
  /** Pill radius instead of the default 12px button radius. */
  pill?: boolean;
  href?: string;
  className?: string;
  children: ReactNode;
};

/** Merges button + anchor attrs (minus the few we own) so the same component types both render targets. */
export type ButtonProps = SharedProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement> & AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">;

const base =
  "inline-flex min-h-12 items-center justify-center gap-2 px-6 font-display text-base font-bold transition-transform duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark disabled:opacity-50 disabled:pointer-events-none";

// Punch-shadow press feedback (DESIGN.md): shadow shrinks + element shifts
// toward it on press, the only elevation strategy — never a soft shadow.
const variants: Record<Variant, string> = {
  primary:
    "bg-coral text-cream shadow-punch active:translate-x-[3px] active:translate-y-[4px] active:shadow-[3px_4px_0_0_var(--ink)]",
  secondary:
    "bg-paper text-ink border-2 border-ink active:translate-x-[1px] active:translate-y-[1px]",
  ghost: "bg-transparent text-ink hover:bg-paper active:translate-x-[1px] active:translate-y-[1px]",
};

/** Renders <button> or <a> (via `href`) with the v4 punch-press button styles. */
export function Button({ variant = "primary", pill = false, href, className = "", children, ...rest }: ButtonProps) {
  const classes = `${base} ${variants[variant]} ${pill ? "rounded-pill" : "rounded-button"} ${className}`;

  if (href) {
    return (
      <a href={href} className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </a>
    );
  }

  return (
    <button className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
