-- Task B: append-only consent event log.
--
-- Bugs this closes: (1) repeat join / re-opt-in overwrote members.consent_ts
-- + consent_version in place, losing history — a disputed send could
-- postdate the only stored consent; (2) only a version TAG was stored, never
-- the literal wording shown. This table is the immutable history; members
-- .consent_ts / members.consent_version remain the current-state cache,
-- unchanged semantics.
--
-- Composite FK + RLS posture copied from events/audit_log in the init
-- migration (20260716000000_init.sql). No update/delete policy or grant for
-- ANY role — append only, structurally, not just by convention.

create table consent_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  member_id uuid not null,
  action text not null check (action in ('join','rejoin','optin_sms','optout_sms')),
  consent_version text not null,
  wording text not null,               -- exact rendered consent copy at that moment (src/lib/booth/consent.ts helpers)
  source text not null,                -- calling flow, e.g. 'self_scan' (web join), 'sms_inbound'
  created_at timestamptz not null default now(),
  foreign key (member_id, restaurant_id) references members(id, restaurant_id) on delete cascade  -- [Cx-1] composite-FK anchor, same idiom as events/reward_grants
);
create index idx_consent_events_restaurant on consent_events(restaurant_id, created_at desc);
create index idx_consent_events_member on consent_events(member_id, created_at desc);

alter table consent_events enable row level security;

create policy "owner reads own consent events" on consent_events for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));

-- The init migration's `alter default privileges ... grant select, insert,
-- update, delete on tables to anon, authenticated, service_role` applies to
-- every table created afterward, including this one — so update/delete must
-- be revoked explicitly here. This matters most for service_role: it
-- bypasses RLS entirely, so the RLS posture above alone would not stop an
-- application bug from mutating history through the admin client.
revoke update, delete on consent_events from anon, authenticated, service_role;
