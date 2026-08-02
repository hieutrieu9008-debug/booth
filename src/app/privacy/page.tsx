/* REVIEW: replace with counsel-approved copy before launch */
import type { Metadata } from "next";
import { Section } from "@/components/kit";

export const metadata: Metadata = {
  title: "Privacy — Booth Loyalty",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className="bg-paper">
      <Section bg="paper">
        <div className="mx-auto max-w-2xl">
          <h1 className="font-display text-4xl font-extrabold text-ink">Privacy</h1>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            This page is being finalised ahead of launch. Questions: hello@boothloyalty.com.
          </p>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            In short: we store a diner&apos;s name, phone number, visit history, and consent record so we can run
            your restaurant&apos;s loyalty programme. Diners can reply STOP to any text at any time to opt out.
          </p>
        </div>
      </Section>
    </main>
  );
}
