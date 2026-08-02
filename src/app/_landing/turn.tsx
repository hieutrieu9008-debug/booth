import { Card, Section, Stamp, WaveDivider } from "@/components/kit";

export function Turn() {
  return (
    <>
      <WaveDivider fill="var(--cream)" className="relative z-10 -mt-16 sm:-mt-24" />
      <Section bg="cream">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-4xl font-extrabold leading-tight text-ink sm:text-5xl">
            We give them a reason to come back.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            Booth is your restaurant&apos;s own text-message loyalty programme. Diners join at the table with just a
            name and number, every visit counts toward rewards they actually want, and the rewards arrive by text —
            redeemed at your till in seconds. You see exactly how many people came back.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-2xl">
          <Card bg="white" shadow border className="relative px-6 py-10 text-center sm:px-12">
            <p className="font-display text-4xl font-extrabold leading-[0.95] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              ~100 customers back a month
            </p>
            <p className="mt-5 text-xl font-semibold text-ink">that&apos;s about 3 a day</p>
            <p className="mt-2 text-xl font-semibold text-ink">
              at a £15 average ticket, roughly £1,500 of comebacks
            </p>
            <Stamp tone="butter" rotate={-6} className="absolute -right-4 -top-6 sm:-right-8">
              Example month — not a promise
            </Stamp>
          </Card>
        </div>
      </Section>
    </>
  );
}
