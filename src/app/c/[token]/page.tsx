import QRCode from "qrcode";
import { Card } from "@/components/kit";
import { formatPhoneNational } from "@/lib/booth/format";
import { getMemberCard } from "@/lib/booth/members";
import { ladderTotals } from "@/lib/booth/ladder";
import { parseProgramConfig } from "@/lib/booth/programs";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { Celebration } from "./celebration";
import { MemberCardHeader } from "./card-header";
import { LadderMap } from "./ladder-map";
import { MemberSessionEffect } from "./member-session-effect";
import { RewardCard } from "./reward-card";
import { resolveMagicMember } from "./data";

const QR_OPTS = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#000000", light: "#FFFFFF" } };

// getMemberCard's restaurant projection (src/lib/booth/members.ts, out of
// this chunk's fence) doesn't include phone_prefix, so the prefix is
// inferred from the stored E.164 itself against the platform's known
// prefixes rather than hardcoding +44.
const KNOWN_PHONE_PREFIXES = ["+44", "+353", "+61", "+1"];

/** The diner's own E.164 number, shown for staff manual lookup — national-format grouped for readability. */
function backupCode(e164: string): string {
  const prefix = KNOWN_PHONE_PREFIXES.find((p) => e164.startsWith(p));
  return prefix ? formatPhoneNational(e164, prefix) : e164;
}

export default async function MemberCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ qa?: string }>;
}) {
  const { token } = await params;
  const { qa } = await searchParams;
  const memberId = await resolveMagicMember(token);
  const card = memberId ? await getMemberCard(memberId) : null;
  if (!card) {
    return (
      <main className="min-h-screen bg-paper px-6 py-16">
        <Card border className="mx-auto max-w-md">
          <h1 className="font-display text-3xl font-extrabold">This link has expired.</h1>
          <p className="mt-3 text-base text-muted">Text CARD to the number your card came from and we&apos;ll send a fresh link.</p>
        </Card>
      </main>
    );
  }

  // WS-B item 1: self-scan awareness copy — only shown when this restaurant's
  // visit_mode allows self check-in. getMemberCard's restaurant projection
  // (src/lib/booth/members.ts, out of this chunk's fence) doesn't include
  // visit_mode, so it's fetched here rather than widening that shared query.
  const admin = createSupabaseAdminClient();
  const { data: visitModeRow } = await admin.from("restaurants").select("visit_mode").eq("id", card.restaurant.id).single();
  const selfScanAvailable = visitModeRow?.visit_mode === "self_scan" || visitModeRow?.visit_mode === "both";

  // WS-E item 4: birthday line only when an active birthday program actually
  // exists for this restaurant — no invented promise when none is configured.
  const { data: birthdayPrograms } = await admin
    .from("reward_programs")
    .select("config")
    .eq("restaurant_id", card.restaurant.id)
    .eq("type", "birthday")
    .eq("active", true)
    .limit(1);
  const birthdayProgram = birthdayPrograms?.[0];
  const birthdayReward = birthdayProgram ? parseProgramConfig("birthday", birthdayProgram.config) : null;
  const birthdayRewardText = birthdayReward?.type === "birthday" ? birthdayReward.config.reward : null;

  const qr = await QRCode.toDataURL(`bl:m:${card.member.qr_token}`, { ...QR_OPTS, width: 440 });
  const grantQrs = await Promise.all(card.activeGrants.map((grant) => QRCode.toDataURL(`bl:r:${grant.one_use_token}`, { ...QR_OPTS, width: 440 })));

  const ladders = card.progress.map(({ program, progress, display }) => ({
    program,
    progress,
    display,
    config: (() => {
      const parsed = parseProgramConfig(program.type, program.config);
      return parsed.type === "visit_ladder" ? parsed.config : null;
    })(),
  }));

  const firstLadder = ladders[0];
  let fallbackReward = "your next reward";
  if (firstLadder?.config) {
    const total = ladderTotals(firstLadder.config, firstLadder.progress);
    const nextRung = firstLadder.config.rungs.find((r) => r.visits > total) ?? firstLadder.config.rungs.at(-1)!;
    fallbackReward = nextRung.options.length > 1 ? `your pick of ${nextRung.options.map((o) => o.reward).join(" or ")}` : nextRung.options[0].reward;
  }

  // WS-E item 1: celebration for a freshly earned grant — any active grant
  // not yet redeemed is eligible; celebration.tsx dedupes per-device via
  // localStorage so it only actually renders the ones this browser hasn't
  // seen yet.
  const celebrationGrants = card.activeGrants.map((g) => ({ id: g.id, reward_text: g.reward_text, expires_at: g.expires_at }));

  return (
    <main className="min-h-screen bg-paper pb-16 text-ink">
      <MemberSessionEffect token={token} />
      <MemberCardHeader
        restaurantName={card.restaurant.name}
        brandColor={card.restaurant.brandColor}
        memberFirstName={card.member.name.split(" ")[0]}
        qrDataUrl={qr}
        backupPhone={backupCode(card.member.phone)}
        initialCollapsed={qa === "scrolled" && process.env.NODE_ENV !== "production"}
      />

      <div className="mx-auto max-w-md space-y-10 px-6 pt-10">
        {/* WS-B item 1: self-scan awareness copy — single line, only when this restaurant's visit_mode allows it. */}
        {selfScanAvailable && (
          <p className="-mt-4 text-sm text-muted">At {card.restaurant.name}? Scan the counter code to check in.</p>
        )}

        <Celebration grants={celebrationGrants} />

        <section>
          <h2 className="font-display text-2xl font-extrabold">Your progress</h2>
          {ladders.length ? (
            ladders.map(({ program, progress, display, config }) =>
              config ? <LadderMap key={program.id} config={config} progress={progress} display={display} programId={program.id} token={token} /> : null
            )
          ) : (
            <Card className="mt-4" border>
              <p>No visit programme is active right now.</p>
            </Card>
          )}
        </section>

        <section id="active-rewards">
          <h2 className="font-display text-2xl font-extrabold">Active rewards</h2>
          {card.activeGrants.length ? (
            <div className="mt-4 space-y-5">
              {card.activeGrants.map((grant, i) => (
                <RewardCard key={grant.id} token={token} qrDataUrl={grantQrs[i]} grant={{ id: grant.id, reward_text: grant.reward_text, reward_options: grant.reward_options, expires_at: grant.expires_at }} />
              ))}
            </div>
          ) : (
            <Card className="mt-4" border>
              <p>Nothing to redeem yet. {Math.max(0, (firstLadder?.display.target ?? 0) - (firstLadder?.display.current ?? 0))} visits to {fallbackReward}.</p>
            </Card>
          )}
        </section>

        {birthdayRewardText && (
          <p className="-mt-4 text-sm text-muted">We&apos;ve got {birthdayRewardText} waiting for your birthday.</p>
        )}
      </div>
    </main>
  );
}
