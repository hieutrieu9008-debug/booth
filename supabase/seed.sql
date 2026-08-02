-- Local dev seed (runs on `supabase db reset`; never applied to cloud).
-- One UK demo tenant with the PRD-shaped program set + two members.

insert into restaurants (id, slug, name, brand_color, timezone, phone_prefix, currency, country,
                         visit_mode, avg_ticket, quiet_hours_start, quiet_hours_end, self_scan_token)
values ('00000000-0000-4000-8000-000000000001', 'demo-kitchen', 'Demo Kitchen',
        '#F26649', 'Europe/London', '+44', 'GBP', 'GB', 'both', 15, 20, 8,
        'venue_demo_selfscan_token');

insert into reward_programs (id, restaurant_id, type, name, active, config) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001',
   'welcome', 'Welcome perk', true,
   '{"reward": "Free garlic naan with your next order", "ring_up_note": "1x garlic naan, no charge", "valid_days": 14}'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001',
   'visit_ladder', 'Visit rewards', true,
   '{"endowed_start": 2, "loop": true, "rungs": [
      {"visits": 6, "options": [{"reward": "Free dessert of your choice", "ring_up_note": "1x dessert, no charge"}]},
      {"visits": 10, "options": [{"reward": "Free main course", "ring_up_note": "1x main, no charge"}]}]}'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001',
   'birthday', 'Birthday treat', true,
   '{"reward": "Free birthday dessert", "mode": "window", "window_days": 14}'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001',
   'come_back', 'We miss you', true,
   '{"blocks": [{"id": "b1", "days_quiet": 28, "reward": "Free starter when you come back", "valid_days": 14}], "min_days_between_contact": 10}');

-- staff pin 1234, HMAC-SHA256 with dev STAFF_AUTH_SECRET 'dev-staff-secret'
-- is not the runtime secret; the app hashes with STAFF_AUTH_SECRET — the seed
-- value here is a placeholder the app re-writes via the PIN management UI; for
-- dev-loop testing use fn-level paths or reseat via dashboard).
insert into staff_pins (id, restaurant_id, label, pin_hash) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001',
   'Front till', 'b1bbc1cbdc4cbbfde9b78eb15874d2386dd94ee4670c11c95e5f052f3cd98c9b');

insert into members (id, restaurant_id, phone, name, birthday_month, birthday_day,
                     consent_ts, consent_version, qr_token) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001',
   '+447700900001', 'Priya Patel', 3, 14, now(), 'pecr-v1 2026-07', 'mqr_demo_priya_000000000001'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001',
   '+447700900002', 'Tom Okafor', null, null, now(), 'pecr-v1 2026-07', 'mqr_demo_tom_0000000000002');

-- ladder enrollment with the endowed head start (2 of 6)
insert into member_progress (member_id, program_id, restaurant_id, endowed_count, earned_count) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000001', 2, 0),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000001', 2, 3);

-- Priya has an unredeemed welcome grant
insert into reward_grants (restaurant_id, member_id, program_id, reward_text, ring_up_note,
                           one_use_token, grant_slot, expires_at) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301',
   '00000000-0000-4000-8000-000000000101', 'Free garlic naan with your next order',
   '1x garlic naan, no charge', 'rwd_demo_priya_welcome_token', 'welcome', now() + interval '14 days');
