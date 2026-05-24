-- One-time cleanup: any active "linked" transaction_links row that is
-- single-sided (one of manual_transaction_id / plaid_transaction_record_id
-- is null) is an orphan from a partial unlink. Mark them unlinked so they
-- stop blocking the linking UI. Also clear the matching denormalized
-- linked_group_id / match_status='linked' flags on the lingering side.
WITH orphans AS (
  SELECT id, manual_transaction_id, plaid_transaction_record_id, linked_group_id
  FROM public.transaction_links
  WHERE status = 'linked'
    AND created_by_user = true
    AND (manual_transaction_id IS NULL OR plaid_transaction_record_id IS NULL)
),
mark_unlinked AS (
  UPDATE public.transaction_links tl
  SET status = 'unlinked', updated_at = now()
  FROM orphans o
  WHERE tl.id = o.id
  RETURNING tl.id, o.linked_group_id, o.manual_transaction_id, o.plaid_transaction_record_id
)
UPDATE public.transactions t
SET match_status = 'unmatched', linked_group_id = NULL
FROM mark_unlinked m
WHERE t.linked_group_id = m.linked_group_id
  AND t.id IN (
    COALESCE(m.manual_transaction_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(m.plaid_transaction_record_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Also clean any groups where every link row is single-sided after the
-- update above (no surviving partner) — already covered, but make sure
-- denormalized flags on standalone tx rows that point to now-empty groups
-- are cleared.
UPDATE public.transactions t
SET match_status = 'unmatched', linked_group_id = NULL
WHERE t.linked_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.transaction_links tl
    WHERE tl.linked_group_id = t.linked_group_id
      AND tl.status = 'linked'
      AND tl.created_by_user = true
      AND tl.manual_transaction_id IS NOT NULL
      AND tl.plaid_transaction_record_id IS NOT NULL
  );