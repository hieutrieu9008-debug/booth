import { Button } from "@/components/kit";

export function Nav() {
  return (
    <header className="w-full bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-8">
        <a href="#top" className="font-display text-2xl font-extrabold text-ink">
          Booth
        </a>
        <div className="flex items-center gap-5">
          <a
            href="/login"
            className="text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline sm:text-base"
          >
            Owner log in
          </a>
          <Button href="#book" className="!min-h-10 !px-4 text-sm sm:!min-h-12 sm:!px-6 sm:text-base">
            Book a 15-minute call
          </Button>
        </div>
      </div>
    </header>
  );
}
