-- Booth Loyalty — Plan V2 deltas (choice-aware ladder rewards, deepest-block
-- win-back, birthday month mode, join-page/branding/menu, atomic
-- redeem-auto-visit). Built for docs/SPEC-WS1.md; [Cx2-N] annotations
-- reference accepted findings from docs/PLAN-V2-ADDENDUM-CODEX.md.
--
-- This migration stays LOCAL until the cutover decision — it is never
-- applied to the cloud project without a separate go-ahead. The data
-- migration below is a no-op on a fresh `supabase db reset` (tables are
-- empty when this file runs, seed.sql/seed-demo.mjs insert canonical
-- shapes directly) — it exists for the eventual cutover onto real data.

-- ============================================================
-- Schema deltas
-- ============================================================
alter table restaurants
  add column join_page jsonb,          -- see joinPageSchema (src/lib/booth/programs.ts)
  add column background_url text,      -- our storage public URL only, set by internal upload action
  add column brand_colors jsonb,       -- ["#hex", ...]; [0] = primary. brand_color column KEPT as legacy fallback [Cx2-24]
  add column menu_items jsonb;         -- [{name, price?, category?}, ...] — see menuItemsSchema; WS5 import flow

alter table reward_grants
  add column reward_options jsonb,     -- immutable option snapshot [{reward, ring_up_note?}] when rung offers a choice; null = fixed [Cx2-6]
  add column chosen_at timestamptz;

alter table events
  add column related_event_id uuid references events(id);  -- auto-visit → its redemption event [Cx2-1/4/27/28]

-- ============================================================
-- Storage [Cx2-25]
-- ============================================================
insert into storage.buckets (id, name, public) values ('branding', 'branding', true)
  on conflict (id) do nothing;
-- NO storage RLS write policies — uploads only via the internal service-role
-- server action (WS5). Public read is fine (logos/backgrounds are public
-- assets). Object keys tenant-scoped: <restaurant_id>/logo.<ext>,
-- <restaurant_id>/background.<ext>. Upload action validates MIME
-- (png/jpeg/webp) + size <= 5MB; background_url/logo_url may only be set to
-- URLs produced by that action.

-- ============================================================
-- Data migration — canonical shapes only, no legacy branches in TS [Cx2-9/18/24]
-- ============================================================

-- visit_ladder rungs: {visits,reward,ring_up_note?} -> {visits, options:[{reward, ring_up_note?}]}
update reward_programs
set config = jsonb_set(
  config,
  '{rungs}',
  (
    select jsonb_agg(
      jsonb_build_object(
        'visits', rung -> 'visits',
        'options', jsonb_build_array(
          jsonb_strip_nulls(jsonb_build_object('reward', rung -> 'reward', 'ring_up_note', rung -> 'ring_up_note'))
        )
      )
    )
    from jsonb_array_elements(config -> 'rungs') as rung
  )
)
where type = 'visit_ladder'
  and config ? 'rungs'
  and not exists (
    select 1 from jsonb_array_elements(config -> 'rungs') as r where r ? 'options'
  );

-- come_back: {reward, valid_days, min_days_between_contact?} ->
--   {blocks:[{id:'b1', days_quiet: <restaurant's gone_quiet_weeks * 7>, reward, valid_days}],
--    min_days_between_contact: coalesce(existing,10)}
update reward_programs rp
set config = jsonb_build_object(
  'blocks', jsonb_build_array(
    jsonb_build_object(
      'id', 'b1',
      'days_quiet', to_jsonb(r.gone_quiet_weeks * 7),
      'reward', rp.config -> 'reward',
      'valid_days', rp.config -> 'valid_days'
    )
  ),
  'min_days_between_contact', coalesce(rp.config -> 'min_days_between_contact', to_jsonb(10))
)
from restaurants r
where rp.restaurant_id = r.id
  and rp.type = 'come_back'
  and not (rp.config ? 'blocks');

-- birthday: add "mode":"window" where missing
update reward_programs
set config = config || jsonb_build_object('mode', 'window')
where type = 'birthday' and not (config ? 'mode');

-- restaurants: brand_colors = [brand_color] where null
update restaurants
set brand_colors = jsonb_build_array(brand_color)
where brand_colors is null;

-- ============================================================
-- fn_redeem_grant v2 — atomic redemption + auto-visit [Cx2-1/2/27/28]
-- ============================================================
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
  v_tz text;
  v_slot text;
  v_visit_event_id uuid;
  v_visit_added boolean := false;
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

    -- A redemption also counts as a visit: same slot computation + conflict
    -- target as fn_record_visit, linked back via related_event_id.
    select timezone into v_tz from restaurants where id = v_grant.restaurant_id;
    v_slot := to_char(now() at time zone coalesce(v_tz, 'Europe/London'), 'YYYY-MM-DD');

    insert into events (restaurant_id, member_id, type, source, staff_pin_id, visit_slot, related_event_id)
    values (v_grant.restaurant_id, v_grant.member_id, 'visit', p_source, p_staff_pin_id, v_slot, v_event_id)
    on conflict (member_id, visit_slot) where type = 'visit' and voided = false
    do nothing
    returning id into v_visit_event_id;

    if v_visit_event_id is not null then
      v_visit_added := true;
      update member_progress mp
      set earned_count = earned_count + 1, updated_at = now()
      from reward_programs rp
      where mp.member_id = v_grant.member_id
        and mp.program_id = rp.id
        and rp.type = 'visit_ladder'
        and rp.active;
    end if;

    return jsonb_build_object('status', 'valid', 'member_name', v_name, 'member_id', v_grant.member_id,
      'restaurant_id', v_grant.restaurant_id,
      'reward_text', v_grant.reward_text, 'ring_up_note', v_grant.ring_up_note,
      'grant_id', v_grant.id, 'event_id', v_event_id,
      'visit_added', v_visit_added, 'visit_event_id', v_visit_event_id);
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

-- ============================================================
-- fn_undo_event v2 — atomic redemption undo cascades to its auto-visit [Cx2-4/8/28]
-- ============================================================
create or replace function fn_undo_event(
  p_event_id uuid,
  p_staff_pin_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_event events%rowtype;
  v_blocked int;
  v_visit_event events%rowtype;
  v_visit_blocked int;
  v_visit_undone text := 'no';
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
    -- Restore the grant. reward_text/ring_up_note/chosen_at are NEVER reset
    -- here — a diner's recorded choice survives undo; they may re-choose
    -- while the grant is earned again [Cx2-8].
    update reward_grants
      set state = 'earned', redeemed_at = null, redeemed_event_id = null
      where id = v_event.grant_id and state = 'redeemed';

    -- Cascade to the linked auto-visit, if one was created and is still live.
    select * into v_visit_event from events
      where related_event_id = v_event.id and type = 'visit' and voided = false;
    if found then
      select count(*) into v_visit_blocked from reward_grants
        where earned_event_id = v_visit_event.id and state = 'redeemed';
      if v_visit_blocked > 0 then
        v_visit_undone := 'blocked';
      else
        update reward_grants set state = 'voided'
          where earned_event_id = v_visit_event.id and state in ('earned','expired');
        update member_progress mp set earned_count = greatest(earned_count - 1, 0), updated_at = now()
          from reward_programs rp
          where mp.member_id = v_visit_event.member_id and mp.program_id = rp.id
            and rp.type = 'visit_ladder' and rp.active;
        update events set voided = true, voided_at = now(), voided_by_staff_pin_id = p_staff_pin_id
          where id = v_visit_event.id;
        v_visit_undone := 'yes';
      end if;
    end if;
  end if;

  update events set voided = true, voided_at = now(), voided_by_staff_pin_id = p_staff_pin_id
    where id = p_event_id;

  if v_event.type = 'redemption' then
    return jsonb_build_object('status', 'undone', 'type', v_event.type, 'visit_undone', v_visit_undone);
  end if;
  return jsonb_build_object('status', 'undone', 'type', v_event.type);
end;
$$;
