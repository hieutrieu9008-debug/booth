import type { Metadata } from "next";
import { Nav } from "./_landing/nav";
import { Hero } from "./_landing/hero";
import { Pain } from "./_landing/pain";
import { Turn } from "./_landing/turn";
import { Proof } from "./_landing/proof";
import { BookCallForm } from "./_landing/book-call-form";
import { Footer } from "./_landing/footer";

export const metadata: Metadata = {
  title: "Booth Loyalty — bring back your customers with a text",
  description:
    "Your diners join in 15 seconds at the table. Booth gives them a reason to come back — and shows you it's working.",
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <main className="bg-paper">
      <Nav />
      <Hero />
      <Pain />
      <Turn />
      <Proof />
      <BookCallForm />
      <Footer />
    </main>
  );
}
