-- Add 'pending_review' to payment_status. Kept in its own migration
-- because Postgres rejects DDL that references a newly-added enum value
-- (e.g. an index predicate `where status = 'pending_review'`) within the
-- same transaction. The rest of the manual-payments + notifications
-- schema lives in 0024.
alter type payment_status add value if not exists 'pending_review';
