"use client";

import { useState } from "react";
import { Button, PhoneInput } from "@/components/kit";
import { normalizePhone } from "@/lib/booth/format";
import {
  chooseGrant,
  lookupPhone,
  recordVisitLookup,
  redeemLookup,
  type MemberLookupResult,
  type ScanOutcome,
} from "./actions";

// PhoneInput (WS2, kit) stores national-format digits only, e.g. "07700
// 910010" — findMemberByPhone needs the full E.164 string as stored on
// members.phone. normalizePhone resolves the restaurant's own phone_prefix
// (Codex #39 — no hardcoded market here). Preserved verbatim across the F1
// one-screen merge (SPEC-WSB-F.md WS-F item 1) per the orchestrator note:
// this was just rebuilt in WS-A2.

/**
 * Phone lookup pane (SPEC-WSB-F.md WS-F item 1) — mandatory fallback for
 * members whose QR isn't handy. Used to be its own "Phone" tab; now renders
 * directly beneath the compact camera pane in ScanScreen (./scan-screen.tsx),
 * which owns the single shared result panel — this pane reports outcomes up
 * via onResult rather than rendering its own ResultPanel.
 */
export function PhoneLookupPane({
  slug,
  phonePrefix,
  onResult,
}: {
  slug: string;
  phonePrefix: string;
  onResult: (outcome: ScanOutcome) => void;
}) {
  const [phone, setPhone] = useState("");
  const [member, setMember] = useState<MemberLookupResult | null>(null);
  const [looking, setLooking] = useState(false);

  async function handleLookup() {
    const normalized = normalizePhone(phone, phonePrefix);
    if (!normalized) return;
    setLooking(true);
    setMember(await lookupPhone(slug, normalized));
    setLooking(false);
  }

  async function refresh() {
    const normalized = normalizePhone(phone, phonePrefix);
    if (normalized) setMember(await lookupPhone(slug, normalized));
  }

  async function handleVisit() {
    if (!member?.found) return;
    const outcome = await recordVisitLookup(slug, member.memberId);
    onResult(outcome);
    if (navigator.vibrate) navigator.vibrate(60);
    await refresh();
  }

  async function handleRedeem(token: string) {
    const outcome = await redeemLookup(slug, token);
    onResult(outcome);
    if (navigator.vibrate) navigator.vibrate(60);
    await refresh();
  }

  const [choosingGrantId, setChoosingGrantId] = useState<string | null>(null);

  async function handleChoose(grantId: string, optionIndex: number) {
    if (!member?.found) return;
    setChoosingGrantId(grantId);
    await chooseGrant(slug, member.memberId, grantId, optionIndex);
    setChoosingGrantId(null);
    if (navigator.vibrate) navigator.vibrate(60);
    await refresh();
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-paper p-4">
      <PhoneInput value={phone} onChange={setPhone} prefix={phonePrefix} label="Customer phone" />
      <Button onClick={handleLookup} disabled={!phone || looking}>
        {looking ? "Looking up…" : "Look up"}
      </Button>

      {member && !member.found && (
        <div className="mt-2 flex flex-col items-start gap-3">
          <p className="text-lg font-semibold text-ink">No member with that number.</p>
          <Button variant="ghost" href={`/j/${slug}`}>
            Join them at the table
          </Button>
        </div>
      )}

      {member?.found && (
        <div className="mt-2 flex flex-col gap-4 rounded-card border-2 border-ink bg-white p-4">
          <p className="font-display text-2xl font-bold text-ink">{member.name}</p>
          {member.progress.map((p, i) => (
            <p key={i} className="text-base font-semibold text-muted">
              {p.label}
            </p>
          ))}
          <Button onClick={handleVisit}>+1 visit</Button>
          {member.grants.length > 0 && (
            <div className="flex flex-col gap-3">
              {member.grants.map((g) => {
                const needsChoice = g.options !== null && !g.chosenAt;
                if (needsChoice) {
                  return (
                    <div key={g.grantId} className="flex flex-col gap-2 rounded-button border-2 border-line px-3 py-2">
                      <span className="font-display text-base font-bold text-ink">
                        Ask them: {g.options!.map((o) => o.reward).join(" or ")}?
                      </span>
                      <div className="flex flex-col gap-2">
                        {g.options!.map((o, i) => (
                          <button
                            key={i}
                            onClick={() => handleChoose(g.grantId, i)}
                            disabled={choosingGrantId === g.grantId}
                            className="min-h-14 rounded-button bg-coral px-4 font-display text-lg font-bold text-cream disabled:opacity-50"
                          >
                            {o.reward}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={g.grantId}
                    className="flex items-center justify-between gap-3 rounded-button border-2 border-line px-3 py-2"
                  >
                    <span className="text-sm font-semibold text-ink">{g.rewardText}</span>
                    <Button variant="secondary" onClick={() => handleRedeem(g.token)}>
                      Redeem
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
