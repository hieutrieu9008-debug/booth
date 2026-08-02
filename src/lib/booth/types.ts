/**
 * Hand-rolled row types for the Booth v2 model — matches
 * supabase/migrations/20260716000000_init.sql +
 * supabase/migrations/20260718000000_plan_v2.sql. Same style as
 * src/lib/types.ts (no generated Database types in this codebase).
 */

export type RestaurantType = "welcome" | "visit_ladder" | "birthday" | "come_back" | "anytime" | "timed" | "custom";

export type Member = {
  id: string;
  restaurant_id: string;
  phone: string; // E.164
  name: string;
  birthday_month: number | null; // 1-12
  birthday_day: number | null; // 1-31
  consent_ts: string;
  consent_version: string;
  opted_out: boolean;
  opted_out_ts: string | null;
  qr_token: string;
  joined_at: string;
};

export type RewardProgram = {
  id: string;
  restaurant_id: string;
  type: RestaurantType;
  name: string;
  active: boolean;
  config: unknown; // shape validated with zod — see programs.ts
  created_at: string;
};

export type MemberProgress = {
  member_id: string;
  program_id: string;
  restaurant_id: string;
  endowed_count: number;
  earned_count: number;
  cycle: number;
  updated_at: string;
  // Plan V3 — diner's advance pick per upcoming rung; shape validated in
  // choice.ts (parseChoicePref), not here — see that file's docstring.
  choice_pref: unknown | null;
};

export type EventType = "visit" | "redemption";
export type EventSource = "staff_scan" | "self_scan" | "lookup" | "pos_later" | "system";

export type Event = {
  id: string;
  restaurant_id: string;
  member_id: string;
  type: EventType;
  source: EventSource;
  staff_pin_id: string | null;
  grant_id: string | null;
  visit_slot: string | null; // local 'YYYY-MM-DD'
  external_event_id: string | null;
  voided: boolean;
  voided_at: string | null;
  voided_by_staff_pin_id: string | null;
  related_event_id: string | null; // auto-visit -> its causing redemption event [Cx2-1/4/27/28]
  created_at: string;
};

export type GrantState = "earned" | "redeemed" | "expired" | "voided";

export type RewardGrant = {
  id: string;
  restaurant_id: string;
  member_id: string;
  program_id: string;
  campaign_id: string | null;
  reward_text: string;
  ring_up_note: string | null;
  reward_options: { reward: string; ring_up_note?: string | null }[] | null; // immutable option snapshot; null = fixed [Cx2-6]
  chosen_at: string | null;
  state: GrantState;
  one_use_token: string;
  grant_slot: string;
  earned_event_id: string | null;
  expires_at: string | null;
  earned_at: string;
  redeemed_at: string | null;
  redeemed_event_id: string | null;
  // Plan V3 — expiry-reminder dedupe claim (src/app/api/cron/remind-expiring).
  reminder_sent_at: string | null;
};

export type StaffPin = {
  id: string;
  restaurant_id: string;
  label: string;
  pin_hash: string;
  active: boolean;
  created_at: string;
};

export type CampaignAudience = "all" | "gone_quiet" | "redeemed_before" | "new";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "canceled";

export type Campaign = {
  id: string;
  restaurant_id: string;
  audience: CampaignAudience;
  audience_filters: unknown; // shape validated with zod — see audiences.ts; null = base segment only
  body: string;
  program_id: string | null;
  status: CampaignStatus;
  scheduled_for: string | null;
  sent_at: string | null;
  sent_count: number | null;
  created_at: string;
};

export type MagicToken = {
  token_hash: string;
  member_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
};

// ---------------------------------------------------------------------------
// RPC result discriminated unions — mirror the jsonb shapes fn_record_visit /
// fn_redeem_grant / fn_undo_event return.
// ---------------------------------------------------------------------------

export type VisitResult =
  | { status: "visit_added"; event_id: string; member_name: string }
  | { status: "already_today"; member_name: string }
  | { status: "member_not_found" };

export type RedeemResult =
  | {
      status: "valid";
      member_name: string;
      member_id: string;
      restaurant_id: string;
      reward_text: string;
      ring_up_note: string | null;
      grant_id: string;
      event_id: string;
      visit_added: boolean;
      visit_event_id: string | null;
    }
  | { status: "already_used"; member_name: string; reward_text: string; redeemed_at: string }
  | { status: "expired"; member_name: string; reward_text: string }
  | { status: "choice_required"; member_name: string; reward_text: string }
  | { status: "invalid" };

export type UndoResult =
  | { status: "undone"; type: EventType; visit_undone?: "yes" | "no" | "blocked" }
  | { status: "not_found_or_already_voided" }
  | { status: "blocked_redeemed_grant" };
