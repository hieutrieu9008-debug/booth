-- Plan V3 integration: custom per-member offers (WS-C deferred item). LOCAL until cutover.
-- Decision (orchestrator): grants keep a NOT NULL program_id; each restaurant
-- gets ONE hidden 'custom' bucket program (created lazily by the app, always
-- inactive so it can never surface in live offers or campaign attach, both of
-- which require active anytime/timed). Grant slots: custom:<uuid>.

alter table reward_programs drop constraint if exists reward_programs_type_check;
alter table reward_programs add constraint reward_programs_type_check
  check (type in ('welcome','visit_ladder','birthday','come_back','anytime','timed','custom'));

-- One bucket per restaurant.
create unique index if not exists reward_programs_one_custom_bucket
  on reward_programs (restaurant_id) where (type = 'custom');
