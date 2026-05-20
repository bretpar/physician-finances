WITH legacy_real_groups AS (
  SELECT
    t.linked_group_id,
    (array_agg(t.user_id ORDER BY t.created_at))[1] AS user_id,
    (array_agg(t.organization_id ORDER BY t.created_at))[1] AS organization_id,
    array_agg(t.id ORDER BY t.id) AS transaction_ids
  FROM public.transactions t
  WHERE t.linked_group_id IS NOT NULL
    AND t.match_status = 'linked'
  GROUP BY t.linked_group_id
  HAVING count(*) >= 2
), legacy_pairs AS (
  SELECT
    g.linked_group_id,
    g.user_id,
    g.organization_id,
    ids_a.tx_id AS tx_a,
    ids_b.tx_id AS tx_b
  FROM legacy_real_groups g
  CROSS JOIN LATERAL unnest(g.transaction_ids) WITH ORDINALITY AS ids_a(tx_id, pos_a)
  CROSS JOIN LATERAL unnest(g.transaction_ids) WITH ORDINALITY AS ids_b(tx_id, pos_b)
  WHERE ids_a.pos_a < ids_b.pos_b
), missing_pairs AS (
  SELECT p.*
  FROM legacy_pairs p
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.transaction_links l
    WHERE l.status = 'linked'
      AND l.created_by_user = true
      AND l.linked_group_id = p.linked_group_id
      AND (
        (l.manual_transaction_id = p.tx_a AND l.plaid_transaction_record_id = p.tx_b)
        OR (l.manual_transaction_id = p.tx_b AND l.plaid_transaction_record_id = p.tx_a)
      )
  )
)
INSERT INTO public.transaction_links (
  user_id,
  organization_id,
  linked_group_id,
  manual_transaction_id,
  plaid_transaction_record_id,
  status,
  created_by_user
)
SELECT
  user_id,
  organization_id,
  linked_group_id,
  tx_a,
  tx_b,
  'linked',
  true
FROM missing_pairs;

WITH real_linked_transactions AS (
  SELECT manual_transaction_id AS transaction_id
  FROM public.transaction_links
  WHERE status = 'linked'
    AND created_by_user = true
    AND manual_transaction_id IS NOT NULL
  UNION
  SELECT plaid_transaction_record_id AS transaction_id
  FROM public.transaction_links
  WHERE status = 'linked'
    AND created_by_user = true
    AND plaid_transaction_record_id IS NOT NULL
)
UPDATE public.transactions t
SET linked_group_id = NULL,
    match_status = 'unmatched'
WHERE (t.linked_group_id IS NOT NULL OR t.match_status = 'linked')
  AND NOT EXISTS (
    SELECT 1
    FROM real_linked_transactions r
    WHERE r.transaction_id = t.id
  );