-- Delivery-status callback endpoint (POST /api/sms/status).
--
-- Purpose: providers POST a delivery receipt for a previously-sent message
-- (matched via messages.provider_sid), which the route uses to advance
-- messages.status to 'delivered' or 'failed' and record when delivery was
-- confirmed. Additive only — the messages.status check constraint already
-- allows 'delivered'/'failed' (init migration), so no constraint change here.

alter table messages add column delivered_ts timestamptz;
