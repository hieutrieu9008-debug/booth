"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/kit";
import type { DrawerDetails } from "@/lib/booth/dashboard-data";

const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value)) : "never";

function DrawerBody({ details }: { details: DrawerDetails }) {
  return (
    <div className="mt-8 space-y-10">
      <section>
        <h2 className="font-display text-xl font-bold">Campaigns: sent → redeemed</h2>
        {details.campaigns.length === 0 ? (
          <p className="mt-3 text-base text-muted">No campaigns sent yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {details.campaigns.map((c) => (
              <Card key={c.id} border className="!p-4">
                <p className="text-sm font-semibold text-muted">
                  {c.audience} · {formatDate(c.sentAt)}
                </p>
                <p className="mt-1 text-base">{c.body}</p>
                <p className="mt-2 font-display text-lg font-bold">
                  {c.sentCount} sent → {c.redeemedCount} redeemed
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-xl font-bold">Opt-out rate this month</h2>
        <p className="mt-3 text-base">
          {details.optOutRate.pct != null ? `${details.optOutRate.pct}%` : "—"} ({details.optOutRate.optOuts} STOPs
          / {details.optOutRate.sends} marketing sends)
        </p>
      </section>

      <section id="whos-close">
        <h2 className="font-display text-xl font-bold">Who&apos;s close</h2>
        {details.whosClose.length === 0 ? (
          <p className="mt-3 text-base text-muted">Nobody is within 1-2 visits of their next reward right now.</p>
        ) : (
          <>
            <p className="mt-3 text-base">
              {details.whosClose.length} {details.whosClose.length === 1 ? "person is" : "people are"} within 1-2
              visits of their next reward.
            </p>
            <ul className="mt-4 space-y-2">
              {details.whosClose.slice(0, 5).map((m) => (
                <li key={m.memberId} className="flex items-center justify-between border-b-2 border-line pb-2">
                  <Link href={`/dashboard/members/${m.memberId}`} className="font-semibold underline">
                    {m.name}
                  </Link>
                  <span className="text-sm text-muted">
                    {m.label} · {m.visitsToGo} to go
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/dashboard/members?view=close_to_reward"
              className="mt-4 inline-block text-sm font-semibold text-coral-dark underline"
            >
              See everyone in Members →
            </Link>
          </>
        )}
      </section>

      <section>
        <h2 className="font-display text-xl font-bold">Gone quiet</h2>
        {details.quietMembers.length === 0 ? (
          <p className="mt-3 text-base text-muted">Nobody has gone quiet right now.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {details.quietMembers.map((m) => (
              <li key={m.memberId} className="flex items-center justify-between border-b-2 border-line pb-2">
                <span className="font-semibold">{m.name}</span>
                <span className="text-sm text-muted">last visit {formatDate(m.lastVisitAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const OPEN_DRAWER_EVENT = "booth:open-drawer";

function DrawerRoot({ details }: { details: DrawerDetails }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleOpen() {
      setOpen(true);
      requestAnimationFrame(() => document.getElementById("whos-close")?.scrollIntoView({ behavior: "smooth" }));
    }
    window.addEventListener(OPEN_DRAWER_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_DRAWER_EVENT, handleOpen);
  }, []);

  return (
    <div className="mt-10">
      <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide details" : "Show details"}
      </Button>
      {open && <DrawerBody details={details} />}
    </div>
  );
}

function SeeWhosCloseButton() {
  return (
    <Button
      variant="secondary"
      className="mt-6 w-full"
      onClick={() => window.dispatchEvent(new Event(OPEN_DRAWER_EVENT))}
    >
      See who&apos;s close
    </Button>
  );
}

export const Drawer = DrawerRoot;
export { SeeWhosCloseButton };
