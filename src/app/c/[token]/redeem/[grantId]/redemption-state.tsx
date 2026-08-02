"use client";
import { useEffect, useState } from "react";
import { Stamp } from "@/components/kit";
import { pollGrant, type GrantPoll } from "./actions";
export function RedemptionState({ token, grantId, initial, rewardText, children }: { token: string; grantId: string; initial: GrantPoll; rewardText: string; children: React.ReactNode }) {
  const [grant, setGrant] = useState(initial);
  useEffect(() => { if (grant.state !== "earned") return; let active = true; const check = async () => { if (document.visibilityState !== "visible") return; const next = await pollGrant(token, grantId); if (active) setGrant(next); }; const id = window.setInterval(check, 3000); const visible = () => { if (document.visibilityState === "visible") void check(); }; document.addEventListener("visibilitychange", visible); return () => { active = false; window.clearInterval(id); document.removeEventListener("visibilitychange", visible); }; }, [grant.state, grantId, token]);
  if (grant.state === "redeemed") return <main className="min-h-screen bg-cream px-6 py-16 text-center text-ink"><div className="mx-auto max-w-md"><h1 className="font-display text-7xl font-extrabold">Enjoy.</h1><p className="mt-6 font-display text-3xl font-bold">{rewardText}</p><Stamp className="mt-10">redeemed {grant.redeemedAt ? new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(new Date(grant.redeemedAt)) : "now"}</Stamp><a href={`/c/${token}`} className="mt-12 inline-flex min-h-12 items-center font-display font-bold underline">Back to my card</a></div></main>;
  if (grant.state !== "earned") { const title = grant.state === "expired" ? "This reward has expired." : grant.state === "voided" ? "This reward is no longer available." : "This reward link isn't valid."; return <main className="min-h-screen bg-cream px-6 py-16 text-ink"><div className="mx-auto max-w-md text-center"><h1 className="font-display text-4xl font-extrabold">{title}</h1><p className="mt-4 text-lg">Ask the restaurant if you need help.</p><a href={`/c/${token}`} className="mt-10 inline-flex min-h-12 items-center font-display font-bold underline">Back to my card</a></div></main>; }
  return children;
}
