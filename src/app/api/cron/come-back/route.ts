import { createMemberCardLink } from "@/lib/booth/links";
import { localYMD } from "@/lib/booth/engine";
import { parseProgramConfig } from "@/lib/booth/programs";
import { getMessageTemplates } from "@/lib/booth/settings-data";
import { renderTemplate, withStopSuffix } from "@/lib/booth/template";
import { newRewardToken } from "@/lib/booth/tokens";
import type { Member, RewardProgram } from "@/lib/booth/types";
import { sendMarketing } from "@/lib/sms/dispatch";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireCronAuth } from "../_lib";

// Statuses that count as "contact" for the leave-alone guard [Cx2-15]. A
// queued send is already committed to going out, so it still blocks a
// second nudge; failed/suppressed never reached (or were deliberately
// withheld from) the member, so they must not block one.
const CONTACTED_STATUSES = ["queued", "sent", "delivered", "simulated"];

/**
 * Daily: per active come_back program, gone-quiet members are computed
 * directly from each member's last non-voided visit (else joined_at) and
 * the program's block thresholds — NOT via segmentMembers/gone_quiet_weeks,
 * which stays a dashboard-only segment [Cx2-12]. Only the DEEPEST matured
 * block a member hasn't received this restaurant-local month fires — the
 * slot `come_back:<block.id>:<YYYY-MM>` caps it at one win-back/member/month
 * per program, and also checks the legacy `come_back:<YYYY-MM>` slot so a
 * pre-Plan-V2 grant this month still counts [Cx2-13/14/16].
 */
export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const counters = { programs: 0, grantsCreated: 0, sent: 0 };

  const { data: programs, error: programsError } = await admin
    .from("reward_programs")
    .select("*")
    .eq("type", "come_back")
    .eq("active", true);
  if (programsError) throw programsError;

  for (const program of (programs ?? []) as RewardProgram[]) {
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "come_back") continue;
    counters.programs++;

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .select("id, name, timezone")
      .eq("id", program.restaurant_id)
      .single();
    if (restaurantError) throw restaurantError;
    const templates = await getMessageTemplates(program.restaurant_id);

    const now = new Date();
    const today = localYMD(restaurant.timezone, now);
    const localMonth = `${today.year}-${String(today.month).padStart(2, "0")}`;

    const { data: members, error: membersError } = await admin
      .from("members")
      .select("*")
      .eq("restaurant_id", program.restaurant_id)
      .eq("opted_out", false);
    if (membersError) throw membersError;

    const { data: visitRows, error: visitsError } = await admin
      .from("events")
      .select("member_id, created_at")
      .eq("restaurant_id", program.restaurant_id)
      .eq("type", "visit")
      .eq("voided", false)
      .order("created_at", { ascending: false });
    if (visitsError) throw visitsError;
    const lastVisitByMember = new Map<string, string>();
    for (const row of visitRows ?? []) {
      const memberId = row.member_id as string;
      if (!lastVisitByMember.has(memberId)) lastVisitByMember.set(memberId, row.created_at as string);
    }

    const guardDays = parsed.config.min_days_between_contact;
    const guardCutoff =
      guardDays > 0 ? new Date(now.getTime() - guardDays * 24 * 60 * 60 * 1000).toISOString() : null;

    for (const member of (members ?? []) as Member[]) {
      const lastVisitAt = lastVisitByMember.get(member.id) ?? member.joined_at;
      const daysQuiet = Math.floor((now.getTime() - new Date(lastVisitAt).getTime()) / (24 * 60 * 60 * 1000));

      // Deepest matured block this member hasn't received.
      let block: (typeof parsed.config.blocks)[number] | null = null;
      for (const candidate of parsed.config.blocks) {
        if (candidate.days_quiet <= daysQuiet) block = candidate;
      }
      if (!block) continue;

      const slot = `come_back:${block.id}:${localMonth}`;
      const legacySlot = `come_back:${localMonth}`;
      const { data: existingGrant, error: existingGrantError } = await admin
        .from("reward_grants")
        .select("id")
        .eq("member_id", member.id)
        .eq("program_id", program.id)
        .in("grant_slot", [slot, legacySlot])
        .maybeSingle();
      if (existingGrantError) throw existingGrantError;
      if (existingGrant) continue;

      if (guardCutoff) {
        const { data: recentMarketing, error: recentMarketingError } = await admin
          .from("messages")
          .select("id")
          .eq("member_id", member.id)
          .eq("kind", "marketing")
          .in("status", CONTACTED_STATUSES)
          .gte("created_at", guardCutoff)
          .limit(1)
          .maybeSingle();
        if (recentMarketingError) throw recentMarketingError;
        if (recentMarketing) continue;
      }

      const expiresAt = new Date(now.getTime() + block.valid_days * 24 * 60 * 60 * 1000).toISOString();
      const { data: inserted, error: insertError } = await admin
        .from("reward_grants")
        .upsert(
          {
            restaurant_id: program.restaurant_id,
            member_id: member.id,
            program_id: program.id,
            reward_text: block.reward,
            ring_up_note: null,
            one_use_token: newRewardToken(),
            grant_slot: slot,
            expires_at: expiresAt,
            earned_at: now.toISOString(),
          },
          { onConflict: "member_id,program_id,grant_slot", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (insertError) throw insertError;
      if (!inserted) continue;
      counters.grantsCreated++;

      const cardLink = await createMemberCardLink(member.id);
      const body = withStopSuffix(
        templates.come_back
          ? renderTemplate(templates.come_back, { restaurant: restaurant.name, reward: block.reward, link: cardLink })
          : `${restaurant.name}: we miss you. ${block.reward} is waiting on your card → ${cardLink}`
      );
      const result = await sendMarketing({ restaurantId: program.restaurant_id, memberId: member.id, body });
      if (result.status !== "suppressed_optout" && result.status !== "failed") counters.sent++;
    }
  }

  return Response.json(counters);
}
