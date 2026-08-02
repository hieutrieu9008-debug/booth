"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard/overview", label: "Overview" },
  { href: "/dashboard/members", label: "Members" },
  { href: "/dashboard/rewards", label: "Rewards" },
  { href: "/dashboard/messages", label: "Messages" },
  { href: "/dashboard/signs", label: "Signs" },
  { href: "/dashboard/staff", label: "Staff" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function NavTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-6" aria-label="Dashboard sections">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`whitespace-nowrap rounded-t-button px-4 py-3 font-display text-sm font-bold transition-colors ${
              active ? "bg-paper text-ink" : "text-muted hover:text-ink"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
