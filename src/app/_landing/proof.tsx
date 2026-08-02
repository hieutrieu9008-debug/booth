import { Section, WaveDivider } from "@/components/kit";

export function Proof() {
  return (
    <>
      <WaveDivider fill="var(--paper)" className="relative z-10 -mt-16 sm:-mt-24" />
      <Section bg="paper" className="!py-6 sm:!py-8">
        <p className="text-center text-base font-semibold text-muted">
          Pilot restaurants running now. Case studies coming.
        </p>
      </Section>
    </>
  );
}
