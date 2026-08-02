/* REVIEW: replace with counsel-approved copy before launch */
import type { Metadata } from "next";
import { Section } from "@/components/kit";

export const metadata: Metadata = {
  title: "Terms — Booth Loyalty",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="bg-paper">
      <Section bg="paper">
        <div className="mx-auto max-w-2xl">
          <h1 className="font-display text-4xl font-extrabold text-ink">Terms</h1>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            This page is being finalised ahead of launch. Questions: hello@boothloyalty.com.
          </p>
        </div>
      </Section>
    </main>
  );
}
