import { Button, Card, Stamp, WaveDivider, Section, Skeleton, Field, Checkbox } from "@/components/kit";

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-2xl font-extrabold text-ink">{children}</h2>;
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display text-lg font-bold text-ink">{children}</h3>;
}

export default function KitGalleryPage() {
  return (
    <main className="bg-paper">
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8">
        <h1 className="font-display text-4xl font-extrabold text-ink">Booth kit — v4 &quot;Fill Tuesday&quot;</h1>
        <p className="mt-2 max-w-2xl text-base text-muted">
          Every component, every variant/state, per DESIGN.md. This page is how the kit gets visually verified —
          check punch shadows, press feedback, radii, and AA text pairing at a glance.
        </p>

        {/* ---------------------------------------------------------------- */}
        <section className="mt-16">
          <Heading>Buttons</Heading>
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <Button variant="primary">Primary</Button>
            <Button variant="primary" pill>
              Primary pill
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="primary" href="#">
              As link (href)
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted">
            Press-feedback note: click and hold the primary button — the punch shadow shrinks from{" "}
            <code>7px 8px</code> to <code>3px 4px</code> and the button translates toward it, the only elevation
            strategy per DESIGN.md (never mixed with a soft shadow).
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="mt-16">
          <Heading>Cards</Heading>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Card bg="white" shadow border>
              <SubHeading>White + shadow + border</SubHeading>
              <p className="mt-2 text-sm text-muted">rounded-card (20px), punch shadow, ink hairline.</p>
            </Card>
            <Card bg="paper" radius="sm">
              <SubHeading>Paper, sm radius</SubHeading>
              <p className="mt-2 text-sm text-muted">rounded-card-sm (16px), flat — no shadow.</p>
            </Card>
            <Card bg="white" radius="lg" shadow>
              <SubHeading>White, lg radius + shadow</SubHeading>
              <p className="mt-2 text-sm text-muted">rounded-card-lg (24px).</p>
            </Card>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="mt-16">
          <Heading>Stamps</Heading>
          <div className="mt-10 flex flex-wrap items-center gap-10">
            <Stamp>-6° default</Stamp>
            <Stamp rotate={4} tone="cream">
              +4° cream
            </Stamp>
            <Stamp rotate={-12} shape="circle">
              -12°
            </Stamp>
            <Stamp rotate={0} tone="cream" shape="circle">
              0°
            </Stamp>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="mt-16">
          <Heading>Skeletons</Heading>
          <div className="mt-6 flex flex-col gap-4 max-w-sm">
            <Skeleton />
            <Skeleton variant="line" className="w-3/4" />
            <Skeleton variant="line" className="w-1/2" />
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="mt-16">
          <Heading>Fields</Heading>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 max-w-2xl">
            <Field id="kit-name" label="Restaurant name" placeholder="The Copper Pot" hint="Shown to customers." />
            <Field
              id="kit-phone"
              label="Phone number"
              placeholder="+1 555 000 0000"
              error="That number doesn't look right."
            />
          </div>
          <div className="mt-6">
            <Checkbox id="kit-consent" label="I agree to receive text messages about deals and rewards." />
          </div>
        </section>
      </div>

      {/* ------------------------------------------------------------------ */}
      <div className="mt-16">
        <Heading>
          <span className="mx-auto block max-w-6xl px-6 sm:px-8">Wave transitions between sections</span>
        </Heading>
      </div>

      <Section bg="paper" className="!py-10">
        <p className="text-base text-ink">Paper section — body copy in ink, per AA rules.</p>
      </Section>
      <WaveDivider fill="var(--coral)" />
      <Section bg="coral" className="!py-10">
        <p className="font-display text-2xl font-extrabold text-cream">
          Coral section — LARGE cream headline text only.
        </p>
      </Section>
      <WaveDivider fill="var(--cream)" flip />
      <Section bg="cream" className="!py-10">
        <p className="text-base text-ink">Cream section — body copy in ink.</p>
      </Section>
      <WaveDivider fill="var(--ink)" />
      <Section bg="ink" className="!py-10">
        <p className="font-display text-xl font-bold text-cream">Ink section — cream text on dark block.</p>
      </Section>
      <WaveDivider fill="#ffffff" flip />
      <Section bg="white" className="!py-10">
        <p className="text-base text-ink">White section — body copy in ink.</p>
      </Section>
    </main>
  );
}
