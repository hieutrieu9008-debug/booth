-- Review finding #4 on the delivery-callback endpoint: /api/sms/status looks
-- up messages by provider_sid on every receipt; without an index that is a
-- full-table scan that degrades linearly with send volume.
create index idx_messages_provider_sid on messages(provider_sid) where provider_sid is not null;
