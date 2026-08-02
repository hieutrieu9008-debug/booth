"use client";

import { Button, Card, Section } from "@/components/kit";

export default function ErrorPage({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return (
    <Section bg="paper">
      <Card border className="mx-auto max-w-md">
        <h1 className="font-display text-2xl font-extrabold">Something went wrong.</h1>
        <p className="mt-3 text-base text-muted">Check your connection and try again.</p>
        <Button className="mt-6 w-full" onClick={unstable_retry}>
          Try again
        </Button>
      </Card>
    </Section>
  );
}
