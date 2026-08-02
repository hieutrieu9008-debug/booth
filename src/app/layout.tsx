import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Booth Loyalty",
  description: "Bring back customers through text-message loyalty.",
  // DEMO_NOINDEX=1 is set ONLY on a temporary demo deployment. It must NOT be
  // set on real launch
  // infra, or the product will be invisible to search engines.
  ...(process.env.DEMO_NOINDEX ? { robots: { index: false, follow: false } } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${figtree.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-body">{children}</body>
    </html>
  );
}
