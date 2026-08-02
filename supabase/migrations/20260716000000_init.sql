-- Booth Loyalty — clean init schema (fresh repo, 2026-07-16).
-- Built for docs/PRD-MVP.md. Design adversarially reviewed (Codex, 2026-07-15);
-- the [Cx-N] annotations reference accepted findings from that review.
--
-- Posture: RLS on everywhere; NO anon/authenticated write policies — all writes
-- go through service-role server actions. Owners get scoped SELECT for
-- dashboard reads. The compliance floor (consent, STOP, quiet hours) is
-- platform behavior, never per-tenant-overridable.

-- Local-stack grant hygiene (idempotent; harmless on cloud)
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

-- ============================================================
-- restaurants (tenant) — UK-first defaults
-- ============================================================
create table restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  owner_id uuid references auth.users(id),
  brand_color text not null default '#F26649',
  logo_url text,
  timezone text not null default 'Europe/London',
  phone_prefix text not null default '+44',
  currency text not null default 'GBP',
  country text not null default 'GB',
  quiet_hours_start int not null default 20,   -- marketing sends pause 8pm local...
  quiet_hours_end int not null default 8,      -- ...resume 8am (UK conservative floor)
  visit_mode text not null default 'staff_scan'
    check (visit_mode in ('staff_scan','self_scan','both')),
  avg_ticket numeric check (avg_ticket is null or avg_ticket >= 0),
  self_scan_token text,                        -- venue QR payload for self check-in
  open_hours jsonb,                            -- app-validated: {mon:{open:"11:00",close:"23:00"}|null,...}
  gone_quiet_weeks int not null default 4,
  sms_from text,                               -- dedicated per-restaurant number (E.164), set at provisioning
  created_at timestamptz not null default now()
);
create unique index restaurants_sms_from_key on restaurants(sms_from) where sms_from is not null;
create unique index restaurants_self_scan_token_key on restaurants(self_scan_token) where self_scan_token is not null;

-- ============================================================
-- members
-- ============================================================
create table members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  phone text not null,                         -- E.164
  name text not null,
  birthday_month int check (birthday_month between 1 and 12),
  birthday_day int check (birthday_day between 1 and 31),
  consent_ts timestamptz not null,
  consent_version text not null,               -- wording version tag ('pecr-v1 2026-07')
  opted_out boolean not null default false,
  opted_out_ts timestamptz,
  qr_token text unique not null,               -- stable member-QR payload (crypto-random)
  joined_at timestamptz not null default now(),
  unique (restaurant_id, phone),
  unique (id, restaurant_id),                  -- [Cx-1] composite-FK anchor
  constraint members_birthday_pair check ((birthday_month is null) = (birthday_day is null))  -- [Cx-21]
);
create index idx_members_restaurant on members(restaurant_id);
create index idx_members_phone on members(phone);          -- [Cx-15] join-cap lookups

-- ============================================================
-- reward_programs
-- ============================================================
create table reward_programs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  type text not null check (type in ('welcome','visit_ladder','birthday','come_back','anytime','timed')),
  name text not null,
  active boolean not null default true,
  config jsonb not null default '{}',          -- shapes app-validated (src/lib/booth/programs.ts)
  created_at timestamptz not null default now(),
  unique (id, restaurant_id)                   -- [Cx-1]
);
create index idx_reward_programs_restaurant on reward_programs(restaurant_id) where active;

-- ============================================================
-- member_progress (visit ladders)
-- ============================================================
create table member_progress (
  member_id uuid not null,
  program_id uuid not null,
  restaurant_id uuid not null,
  endowed_count int not null default 0 check (endowed_count >= 0),  -- enrollment snapshot; lap 1 only
  earned_count int not null default 0 check (earned_count >= 0),
  cycle int not null default 1 check (cycle >= 1),
  updated_at timestamptz not null default now(),
  primary key (member_id, program_id),
  foreign key (member_id, restaurant_id) references members(id, restaurant_id) on delete cascade,
  foreign key (program_id, restaurant_id) references reward_programs(id, restaurant_id) on delete cascade
);

-- ============================================================
-- staff_pins
-- ============================================================
create table staff_pins (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  label text not null,
  pin_hash text not null,                      -- HMAC-SHA256(STAFF_AUTH_SECRET, pin)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (restaurant_id, pin_hash)
);

-- ============================================================
-- events — the spine (POS later emits the same shape; zero migration)
-- ============================================================
create table events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  member_id uuid not null,
  type text not null check (type in ('visit','redemption')),
  source text not null check (source in ('staff_scan','self_scan','lookup','pos_later','system')),
  staff_pin_id uuid references staff_pins(id) on delete set null,
  grant_id uuid,                               -- FK added below
  visit_slot text,                             -- local 'YYYY-MM-DD' (restaurant tz), server-computed
  external_event_id text,                      -- [Cx-31] POS idempotency seam
  voided boolean not null default false,
  voided_at timestamptz,
  voided_by_staff_pin_id uuid references staff_pins(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (member_id, restaurant_id) references members(id, restaurant_id) on delete cascade,
  constraint events_shape check (                             -- [Cx-4]
    (type = 'visit'      and visit_slot is not null and grant_id is null) or
    (type = 'redemption' and grant_id is not null and visit_slot is null)
  ),
  constraint events_void_audit check (voided = false or voided_at is not null)
);
create index idx_events_restaurant_time on events(restaurant_id, created_at desc);
create index idx_events_member on events(member_id, created_at desc);
create unique index events_visit_slot_guard
  on events (member_id, visit_slot) where type = 'visit' and voided = false;
create unique index events_external_id_guard
  on events (restaurant_id, external_event_id) where external_event_id is not null;

-- ============================================================
-- reward_grants
-- ============================================================
create table reward_grants (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  member_id uuid not null,
  program_id uuid not null,
  campaign_id uuid,                            -- [Cx-7] FK added after campaigns
  reward_text text not null,                   -- denormalized at grant time
  ring_up_note text,
  state text not null default 'earned' check (state in ('earned','redeemed','expired','voided')),
  one_use_token text unique not null,          -- QR payload bl:r:<token>
  -- [Cx-2] universal race-proof issuance slot:
  --   ladder 'ladder:<rung>:<cycle>' | welcome 'welcome' | birthday 'birthday:<year>'
  --   come_back 'come_back:<YYYY-MM>' | anytime 'anytime:<n>' | timed 'timed:<program_id>'
  --   campaign-attached 'campaign:<campaign_id>'
  grant_slot text not null,
  earned_event_id uuid references events(id),
  expires_at timestamptz,                      -- owner-extendable; null = no expiry
  earned_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_event_id uuid references events(id),
  unique (member_id, program_id, grant_slot),
  foreign key (member_id, restaurant_id) references members(id, restaurant_id) on delete cascade,
  foreign key (program_id, restaurant_id) references reward_programs(id, restaurant_id) on delete cascade,
  constraint grants_redeemed_coherent check ((state = 'redeemed') = (redeemed_at is not null))  -- [Cx-5]
);
create index idx_grants_member on reward_grants(member_id, state);
create index idx_grants_restaurant on reward_grants(restaurant_id, state, earned_at desc);

alter table events add constraint events_grant_fk
  foreign key (grant_id) references reward_grants(id) on delete set null;

-- ============================================================
-- campaigns (blasts + scheduled sends)
-- ============================================================
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  audience text not null default 'all' check (audience in ('all','gone_quiet','redeemed_before','new')),
  body text not null,
  program_id uuid references reward_programs(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','canceled')),
  scheduled_for timestamptz,                   -- null = send-now blast
  sent_at timestamptz,
  sent_count int,
  created_at timestamptz not null default now()
);
create index idx_campaigns_restaurant on campaigns(restaurant_id, created_at desc);
create index idx_campaigns_due on campaigns(scheduled_for) where status = 'scheduled';

alter table reward_grants add constraint grants_campaign_fk
  foreign key (campaign_id) references campaigns(id) on delete set null;

-- ============================================================
-- messages — the outbound/inbound SMS log (channel-abstracted)
-- ============================================================
create table messages (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  member_id uuid references members(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  kind text not null default 'transactional' check (kind in ('transactional','marketing')),
  channel text not null default 'sms',
  body text not null,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','failed','simulated','received','suppressed')),
  not_before timestamptz,                      -- [Cx-14] quiet-hours deferral for queued marketing
  provider_sid text,                           -- provider message id
  created_at timestamptz not null default now()
);
create index idx_messages_restaurant on messages(restaurant_id, created_at desc);
create index idx_messages_member on messages(member_id, created_at desc);
create index idx_messages_queued on messages(not_before) where status = 'queued';

-- [Cx-8] send-time snapshot; unique pair = idempotent fan-out
create table campaign_recipients (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (campaign_id, member_id)
);

-- ============================================================
-- magic_tokens (member-card links; hashed at rest [Cx-16/36])
-- ============================================================
create table magic_tokens (
  token_hash text primary key,                 -- sha256(raw); raw only ever lives in the sent link
  member_id uuid not null references members(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index idx_magic_tokens_member on magic_tokens(member_id);

-- ============================================================
-- audit_log + leads (ops plumbing)
-- ============================================================
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  actor text,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_restaurant on audit_log(restaurant_id, created_at desc);

create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  restaurant_name text not null,
  phone text not null,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS
-- ============================================================
alter table restaurants enable row level security;
alter table members enable row level security;
alter table reward_programs enable row level security;
alter table member_progress enable row level security;
alter table staff_pins enable row level security;
alter table events enable row level security;
alter table reward_grants enable row level security;
alter table campaigns enable row level security;
alter table campaign_recipients enable row level security;
alter table messages enable row level security;
alter table magic_tokens enable row level security;   -- no policies: service-role only
alter table audit_log enable row level security;
alter table leads enable row level security;          -- no policies: service-role only

create policy "owner reads own restaurant" on restaurants for select using (owner_id = auth.uid());
create policy "owner updates own restaurant" on restaurants for update using (owner_id = auth.uid());
create policy "owner reads own members" on members for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
create policy "owner reads own programs" on reward_programs for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
create policy "owner reads own progress" on member_progress for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
create policy "owner reads own staff pins" on staff_pins for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
create policy "owner reads own events" on events for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
create policy "owner reads own grants" on reward_grants for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
create policy "owner reads own campaigns" on campaigns for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
create policy "owner reads own campaign recipients" on campaign_recipients for select
  using (campaign_id in (select id from campaigns where restaurant_id in
    (select id from restaurants where owner_id = auth.uid())));
create policy "owner reads own messages" on messages for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
create policy "owner reads own audit log" on audit_log for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));

-- ============================================================
-- Atomic RPCs. Small on purpose: event + progress here; grant
-- materialization is deterministic TS, idempotent via grant_slot.
-- ============================================================

create or replace function fn_record_visit(
  p_member_id uuid,
  p_source text,
  p_staff_pin_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_member members%rowtype;
  v_tz text;
  v_slot text;
  v_event_id uuid;
begin
  select * into v_member from members where id = p_member_id;
  if not found then
    return jsonb_build_object('status', 'member_not_found');
  end if;

  select timezone into v_tz from restaurants where id = v_member.restaurant_id;
  v_slot := to_char(now() at time zone coalesce(v_tz, 'Europe/London'), 'YYYY-MM-DD');

  insert into events (restaurant_id, member_id, type, source, staff_pin_id, visit_slot)
  values (v_member.restaurant_id, p_member_id, 'visit', p_source, p_staff_pin_id, v_slot)
  on conflict (member_id, visit_slot) where type = 'visit' and voided = false
  do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('status', 'already_today', 'member_name', v_member.name);
  end if;

  update member_progress mp
  set earned_count = earned_count + 1, updated_at = now()
  from reward_programs rp
  where mp.member_id = p_member_id
    and mp.program_id = rp.id
    and rp.type = 'visit_ladder'
    and rp.active;

  return jsonb_build_object('status', 'visit_added', 'event_id', v_event_id,
                            'member_name', v_member.name);
end;
$$;

create or replace function fn_redeem_grant(
  p_token text,
  p_source text,
  p_staff_pin_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_grant reward_grants%rowtype;
  v_event_id uuid;
  v_name text;
begin
  update reward_grants
  set state = 'redeemed', redeemed_at = now()
  where one_use_token = p_token
    and state = 'earned'
    and (expires_at is null or expires_at > now())
  returning * into v_grant;

  if found then
    insert into events (restaurant_id, member_id, type, source, staff_pin_id, grant_id)
    values (v_grant.restaurant_id, v_grant.member_id, 'redemption', p_source, p_staff_pin_id, v_grant.id)
    returning id into v_event_id;

    update reward_grants set redeemed_event_id = v_event_id where id = v_grant.id;
    select name into v_name from members where id = v_grant.member_id;

    return jsonb_build_object('status', 'valid', 'member_name', v_name,
      'reward_text', v_grant.reward_text, 'ring_up_note', v_grant.ring_up_note,
      'grant_id', v_grant.id, 'event_id', v_event_id);
  end if;

  select * into v_grant from reward_grants where one_use_token = p_token;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  select name into v_name from members where id = v_grant.member_id;
  if v_grant.state = 'redeemed' then
    return jsonb_build_object('status', 'already_used', 'member_name', v_name,
      'reward_text', v_grant.reward_text, 'redeemed_at', v_grant.redeemed_at);
  end if;
  if v_grant.state = 'earned' and v_grant.expires_at is not null and v_grant.expires_at <= now() then
    update reward_grants set state = 'expired' where id = v_grant.id and state = 'earned';
  end if;
  return jsonb_build_object('status', 'expired', 'member_name', v_name, 'reward_text', v_grant.reward_text);
end;
$$;

create or replace function fn_undo_event(
  p_event_id uuid,
  p_staff_pin_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event events%rowtype;
  v_blocked int;
begin
  select * into v_event from events where id = p_event_id and voided = false;
  if not found then
    return jsonb_build_object('status', 'not_found_or_already_voided');
  end if;

  if v_event.type = 'visit' then
    select count(*) into v_blocked from reward_grants
      where earned_event_id = v_event.id and state = 'redeemed';
    if v_blocked > 0 then
      return jsonb_build_object('status', 'blocked_redeemed_grant');
    end if;
    update reward_grants set state = 'voided'
      where earned_event_id = v_event.id and state in ('earned','expired');
    update member_progress mp set earned_count = greatest(earned_count - 1, 0), updated_at = now()
      from reward_programs rp
      where mp.member_id = v_event.member_id and mp.program_id = rp.id
        and rp.type = 'visit_ladder' and rp.active;
  else
    update reward_grants
      set state = 'earned', redeemed_at = null, redeemed_event_id = null
      where id = v_event.grant_id and state = 'redeemed';
  end if;

  update events set voided = true, voided_at = now(), voided_by_staff_pin_id = p_staff_pin_id
    where id = p_event_id;
  return jsonb_build_object('status', 'undone', 'type', v_event.type);
end;
$$;

revoke all on function fn_record_visit(uuid, text, uuid) from public, anon, authenticated;
revoke all on function fn_redeem_grant(text, text, uuid) from public, anon, authenticated;
revoke all on function fn_undo_event(uuid, uuid) from public, anon, authenticated;
grant execute on function fn_record_visit(uuid, text, uuid) to service_role;
grant execute on function fn_redeem_grant(text, text, uuid) to service_role;
grant execute on function fn_undo_event(uuid, uuid) to service_role;
