-- Composable blast audiences: optional filters layered on top of the base
-- segment (campaigns.audience). null = base segment only. Shape validated
-- app-side (src/lib/booth/audiences.ts).
alter table campaigns add column audience_filters jsonb;
