import { Section, WaveDivider } from "@/components/kit";

export function Pain() {
  return (
    <>
      <WaveDivider fill="var(--paper)" className="relative z-10 -mt-16 sm:-mt-24" />
      <Section bg="paper">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-4xl font-extrabold leading-tight text-ink sm:text-5xl">
            Your regulars are disappearing. Quietly.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            Most first-time diners never come back. Not because the food let them down — because nothing reminded
            them to. You never see it happen, and you never know who stopped coming.
          </p>
        </div>
      </Section>
    </>
  );
}
