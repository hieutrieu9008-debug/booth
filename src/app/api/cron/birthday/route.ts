import { createMemberCardLink } from "@/lib/booth/links";
import { birthdayGrantParams, daysUntilBirthday, localYMD } from "@/lib/booth/engine";
import { parseProgramConfig, type BirthdayConfig } from "@/lib/booth/programs";
import { renderTemplate, withStopSuffix } from "@/lib/booth/template";
import { newRewardToken } from "@/lib/booth/tokens";
import type { Member, RewardProgram } from "@/lib/booth/types";
import { sendMarketing } from "@/lib/sms/dispatch";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireCronAuth } from "../_lib";

/** WS-D — birthdayConfig.message (with {name}/{reward}/{restaurant}/{link}) when the owner's set one, else the original coded copy per mode. */
function birthdayBody(
  config: BirthdayConfig,
  restaurantName: string,
  member: { name: string },
  cardLink: string,
): string {
  const vars = { name: member.name, reward: config.reward, restaurant: restaurantName, link: cardLink };
  if (config.message) return withStopSuffix(renderTemplate(config.message, vars));
  const body =
    config.mode === "month"
      ? `${restaurantName}: happy birthday month! ${config.reward} is on your card, valid all month → ${cardLink}`
      : `${restaurantName}: happy birthday month! ${config.reward} is on your card → ${cardLink}`;
  return withStopSuffix(body);
}

/**
 * Daily (~09:00 UTC per vercel.json): per active birthday program, a
 * one-per-year grant + proactive text.
 *  - window mode: members whose birthday falls within config.window_days
 *    ahead (restaurant-local today).
 *  - month mode: members whose birthday_month equals today's restaurant-local
 *    month [Cx2-18]. Most month-mode members already got their grant at join
 *    (members.ts's joinMember) — the shared yearly slot means this is a
 *    no-op for them and only catches pre-existing members / join-day misses.
 */
export async function GET(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const admin = createSupabaseAdminClient();
  const counters = { programs: 0, grantsCreated: 0, sent: 0 };

  const { data: programs, error: programsError } = await admin
    .from("reward_programs")
    .select("*")
    .eq("type", "birthday")
    .eq("active", true);
  if (programsError) throw programsError;

  for (const program of (programs ?? []) as RewardProgram[]) {
    const parsed = parseProgramConfig(program.type, program.config);
    if (parsed.type !== "birthday") continue;
    counters.programs++;

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants")
      .select("id, name, timezone")
      .eq("id", program.restaurant_id)
      .single();
    if (restaurantError) throw restaurantError;

    const today = localYMD(restaurant.timezone);
    const slot = `birthday:${today.year}`;

    const { data: members, error: membersError } = await admin
      .from("members")
      .select("*")
      .eq("restaurant_id", program.restaurant_id)
      .eq("opted_out", false)
      .not("birthday_month", "is", null)
      .not("birthday_day", "is", null);
    if (membersError) throw membersError;

    for (const member of (members ?? []) as Member[]) {
      if (member.birthday_month == null || member.birthday_day == null) continue;

      const fires =
        parsed.config.mode === "month"
          ? member.birthday_month === today.month
          : (() => {
              const daysAhead = daysUntilBirthday(member.birthday_month!, member.birthday_day!, today);
              return daysAhead >= 0 && daysAhead <= (parsed.config.window_days ?? 0);
            })();
      if (!fires) continue;

      const { expiresAt } = birthdayGrantParams(parsed.config, restaurant.timezone);
      const { data: inserted, error: insertError } = await admin
        .from("reward_grants")
        .upsert(
          {
            restaurant_id: program.restaurant_id,
            member_id: member.id,
            program_id: program.id,
            reward_text: parsed.config.reward,
            ring_up_note: null,
            one_use_token: newRewardToken(),
            grant_slot: slot,
            expires_at: expiresAt,
            earned_at: new Date().toISOString(),
          },
          { onConflict: "member_id,program_id,grant_slot", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (insertError) throw insertError;
      if (!inserted) continue;
      counters.grantsCreated++;

      const cardLink = await createMemberCardLink(member.id);
      const body = birthdayBody(parsed.config, restaurant.name, member, cardLink);
      const result = await sendMarketing({ restaurantId: program.restaurant_id, memberId: member.id, body });
      if (result.status !== "suppressed_optout" && result.status !== "failed") counters.sent++;
    }
  }

  return Response.json(counters);
}
