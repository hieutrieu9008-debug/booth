import { Button } from "@/components/kit";
import { PhoneArtifact } from "./phone-artifact";
import { Watermark } from "./watermark";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-coral">
      <Watermark />
      <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-10">
        <div className="order-2 lg:order-1">
          <PhoneArtifact />
        </div>
        <div className="order-1 text-center lg:order-2 lg:text-left">
          <p className="font-display text-lg font-extrabold uppercase tracking-wide text-cream sm:text-xl">
            Text-message loyalty for independent restaurants
          </p>
          <h1 className="mt-5 font-display text-6xl font-extrabold leading-[0.92] tracking-tight text-cream sm:text-7xl lg:whitespace-nowrap lg:text-6xl xl:text-7xl">
            <span className="block">Bring back your customers</span>
            <span className="block text-ink">with a text.</span>
          </h1>
          <p className="mx-auto mt-7 max-w-md text-lg leading-relaxed text-cream lg:mx-0">
            Your diners join in 15 seconds at the table. Booth gives them a reason to come back — and shows you
            it&apos;s working.
          </p>
          <div className="mt-9">
            <Button href="#book" variant="secondary" className="shadow-punch">
              Book a 15-minute call
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
