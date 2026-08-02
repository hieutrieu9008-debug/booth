import { WaveDivider } from "@/components/kit";

export function Footer() {
  return (
    <>
      <WaveDivider fill="var(--paper)" className="relative z-10 -mt-16 sm:-mt-24" />
      <footer className="w-full bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 border-t-2 border-line px-6 py-8 text-sm text-muted sm:flex-row sm:justify-between sm:px-8">
          <span className="font-display font-bold text-ink">Booth Loyalty</span>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="mailto:hello@boothloyalty.com" className="font-semibold text-ink hover:text-coral-dark">
              hello@boothloyalty.com
            </a>
            <a href="/privacy" className="font-semibold text-ink hover:text-coral-dark">
              Privacy
            </a>
            <a href="/terms" className="font-semibold text-ink hover:text-coral-dark">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
