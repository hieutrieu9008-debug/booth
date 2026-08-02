import type { HTMLAttributes, ReactNode } from "react";

export type SectionBg = "paper" | "cream" | "coral" | "white" | "ink";

// AA pairing per DESIGN.md: ink on paper/cream/white = body text. On coral,
// cream is only safe for LARGE text (headlines) — keep small print out of
// coral sections, or override locally to text-coral-dark. Ink bg (dark
// blocks) pairs with cream, never pure white. Never pure #000/#fff.
const bgClasses: Record<SectionBg, string> = {
  paper: "bg-paper text-ink",
  cream: "bg-cream text-ink",
  white: "bg-white text-ink",
  coral: "bg-coral text-cream",
  ink: "bg-ink text-cream",
};

export type SectionProps = {
  bg?: SectionBg;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">;

/** Full-width section shell: bg mode + consistent max-w container and px/py rhythm. */
export function Section({ bg = "paper", className = "", children, ...rest }: SectionProps) {
  return (
    <section className={`w-full ${bgClasses[bg]} ${className}`} {...rest}>
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8 sm:py-24">{children}</div>
    </section>
  );
}
