-- Plan V3 (approved 2026-07-18) — wave-2 storage. LOCAL until the cutover decision.
-- Owner: orchestrator. Builders read these columns, never migrate.

-- Owner-adjustable defaults (WS-D Settings page; WS-E reminder timing).
-- Shape convention (ARCHITECTURE.md §5): {"version":1, "extend_notify_default":true, "expiry_reminder_days":3}
-- App-level zod validates; absent keys mean the coded default.
alter table restaurants
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- Owner-editable message templates (WS-D; birthday lives in program config, this
-- holds restaurant-level bodies: welcome, reward_earned, come_back fallbacks).
-- Shape: {"version":1, "welcome": "...", "reward_earned": "...", "reward_earned_choice": "..."}
alter table restaurants
  add column if not exists message_templates jsonb not null default '{}'::jsonb;

-- Expiry-reminder dedupe (WS-E): one reminder per grant, claimed via
-- update ... set reminder_sent_at = now() where reminder_sent_at is null.
alter table reward_grants
  add column if not exists reminder_sent_at timestamptz;

-- Pre-choice (WS-E): member's advance pick per upcoming rung.
-- Shape: {"version":1, "picks": {"<rung visits>:<cycle>": "<option text>"}}
alter table member_progress
  add column if not exists choice_pref jsonb;
