-- Booth Loyalty — server backstop for the unchosen-reward QR bypass (P0 QA
-- finding). A diner could reach /c/[token]/redeem/[grantId]?reveal=1 for a
-- multi-option grant that hasn't been chosen yet and, in dev, see the QR
-- before picking. The UI fix (reward-detail.tsx / redeem/[grantId]/page.tsx)
-- closes that, but fn_redeem_grant itself must also refuse to redeem an
-- unchosen choice grant regardless of how its token reached a scanner.

-- ============================================================
-- fn_redeem_grant v3 — v2 (20260718000000_plan_v2.sql) + refuse unchosen
-- choice grants on both the success path and the fallback diagnosis.
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
    and not (reward_options is not null and chosen_at is null)
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
  if v_grant.state = 'earned' and v_grant.reward_options is not null and v_grant.chosen_at is null then
    return jsonb_build_object('status', 'choice_required', 'member_name', v_name, 'reward_text', v_grant.reward_text);
  end if;
  if v_grant.state = 'earned' and v_grant.expires_at is not null and v_grant.expires_at <= now() then
    update reward_grants set state = 'expired' where id = v_grant.id and state = 'earned';
  end if;
  return jsonb_build_object('status', 'expired', 'member_name', v_name, 'reward_text', v_grant.reward_text);
end;
$$;
