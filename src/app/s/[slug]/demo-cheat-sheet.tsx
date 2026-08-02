"use client";

import { useState } from "react";
import { logoutStaff } from "./actions";

/** Demo tenant only (item 4, SPEC-WS3.md) — gated by restaurant id in staff-client.tsx, never shown for real tenants. */
const CHEAT_NUMBERS = [
  { phone: "07700 910010", demonstrates: "Two unredeemed rewards, incl. one that needs a choice (naan or dessert)" },
  { phone: "07700 910011", demonstrates: "Clean redeem: no choice, just tap Redeem" },
  { phone: "07700 910019", demonstrates: "A rescued regular: came back after going quiet" },
];

export function DemoCheatSheet({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const logout = logoutStaff.bind(null, slug);

  return (
    <div className="border-t-2 border-cream/20 px-3 py-2 text-cream">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="min-h-11 font-display text-xs font-bold uppercase tracking-wide text-cream/70"
        >
          {open ? "Hide" : "Show"} demo cheat sheet
        </button>
        <form action={logout}>
          <button
            type="submit"
            className="min-h-11 rounded-button border-2 border-cream/40 px-3 font-display text-xs font-bold uppercase tracking-wide text-cream"
          >
            Lock
          </button>
        </form>
      </div>
      {open && (
        <ul className="mt-2 flex flex-col gap-2">
          {CHEAT_NUMBERS.map((c) => (
            <li key={c.phone} className="text-xs text-cream/80">
              <span className="font-mono font-bold text-cream">{c.phone}</span>: {c.demonstrates}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
