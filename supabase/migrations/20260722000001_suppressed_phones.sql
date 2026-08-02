-- Task C: diner data erasure — erasure-safe suppression list.
--
-- Purpose: a diner can be opted out AND erased (src/lib/booth/privacy.ts
-- eraseMember). Erasure deletes the members row entirely, so nothing is left
-- to stop a later staff-initiated re-add from silently texting that number
-- again. This table is that block: eraseMember inserts a row here whenever
-- the member being erased was opted_out at the time.
--
-- NO join path clears this row automatically (joinMember refuses EVERY
-- source while suppressed, see src/lib/booth/members.ts). An earlier design
-- let a 'self_scan' join clear it, but the public /j web form sends that
-- exact source, so anyone who knew the number could silently re-subscribe
-- an erased opted-out diner. Adversarial review confirmed the exploit
-- (2026-07-22); do not reintroduce clear-on-join. Rows are removed manually
-- only (white-glove), at the diner's own verified request.

create table suppressed_phones (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  phone text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, phone)
);

alter table suppressed_phones enable row level security;

create policy "owner reads own suppressed phones" on suppressed_phones for select
  using (restaurant_id in (select id from restaurants where owner_id = auth.uid()));
