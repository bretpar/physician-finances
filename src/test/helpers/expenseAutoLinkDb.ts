/**
 * Executable Postgres fixture (PGlite) for the expense auto-link database
 * layer. It builds a minimal `public.transactions` / `public.transaction_links`
 * schema, then loads the REAL migrations that define the trigger, indexes and
 * RPCs, so the tests exercise executed SQL rather than source text.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

export const GROUP_MIGRATION = "supabase/migrations/20260821043642_950261a4-2d00-4e52-9811-3ba86a620121.sql";
export const FIX_MIGRATION = "supabase/migrations/20260821045816_dd599615-5858-4ae9-9890-28834fc8a1e6.sql";

const BASE_SCHEMA = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('test.uid', true), '')::uuid
$$;

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid,
  transaction_date date NOT NULL,
  vendor text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  account_source text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  notes text,
  receipt_url text,
  entity text NOT NULL DEFAULT '',
  company_type text NOT NULL DEFAULT '',
  source_id uuid,
  schedule_c_category text,
  transaction_type text NOT NULL DEFAULT 'expense',
  source_type text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'active',
  match_status text NOT NULL DEFAULT 'unmatched',
  linked_group_id uuid,
  plaid_transaction_ref uuid,
  linked_plaid_transaction_id uuid,
  linked_plaid_amount numeric,
  linked_plaid_posted_date date,
  linked_plaid_account text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.transaction_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid,
  linked_group_id uuid NOT NULL,
  manual_transaction_id uuid,
  plaid_transaction_record_id uuid,
  status text NOT NULL DEFAULT 'linked',
  confidence_score numeric,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_by_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  field_locks jsonb NOT NULL DEFAULT '{}'::jsonb
);
`;

export const USER = "11111111-1111-1111-1111-111111111111";
export const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
export const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";

export async function makeDb() {
  const db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(readFileSync(GROUP_MIGRATION, "utf8"));
  await db.exec(readFileSync(FIX_MIGRATION, "utf8"));
  return db;
}

export interface TxInput {
  id?: string;
  date: string;
  amount: number;
  source?: "manual" | "plaid";
  org?: string | null;
  user?: string;
}

export async function insertTx(db: PGlite, t: TxInput): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO public.transactions
       (id, user_id, organization_id, transaction_date, amount, source_type, vendor)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, 'v')
     RETURNING id`,
    [t.id ?? null, t.user ?? USER, t.org === undefined ? ORG_A : t.org, t.date, t.amount, t.source ?? "manual"],
  );
  return res.rows[0].id;
}

/** Create an active link row directly (bypasses the auto-link RPC). */
export async function linkRow(
  db: PGlite,
  args: { group: string; manual: string; plaid: string; linkedAt?: string; status?: string },
) {
  await db.query(
    `INSERT INTO public.transaction_links
       (user_id, organization_id, linked_group_id, manual_transaction_id, plaid_transaction_record_id, status, linked_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'linked'), COALESCE($7::timestamptz, now()))`,
    [USER, ORG_A, args.group, args.manual, args.plaid, args.status ?? null, args.linkedAt ?? null],
  );
  await db.query(
    `UPDATE public.transactions SET match_status = 'linked', linked_group_id = $1,
       status = CASE WHEN id = $3 THEN 'merged' ELSE 'active' END
     WHERE id IN ($2, $3)`,
    [args.group, args.manual, args.plaid],
  );
}

export async function pair(db: PGlite, manual: string, plaid: string) {
  const res = await db.query<{ r: any }>(`SELECT public.auto_link_expense_pair($1, $2, 100) AS r`, [manual, plaid]);
  return res.rows[0].r as { linked: boolean; reason?: string; linked_group_id?: string };
}

export async function batch(db: PGlite, user = USER) {
  const res = await db.query<{ r: any }>(`SELECT public.auto_link_expenses_for_user($1) AS r`, [user]);
  return res.rows[0].r as { linked: number; considered: number };
}

export async function cleanup(db: PGlite, user = USER) {
  const res = await db.query<{ r: any }>(`SELECT public.cleanup_conflicting_transaction_links($1) AS r`, [user]);
  return res.rows[0].r as Record<string, number>;
}

export async function tx(db: PGlite, id: string) {
  const res = await db.query<any>(
    `SELECT id, status, match_status, linked_group_id, source_type FROM public.transactions WHERE id = $1`,
    [id],
  );
  return res.rows[0];
}

export async function activeGroupsFor(db: PGlite, id: string): Promise<string[]> {
  const res = await db.query<{ linked_group_id: string }>(
    `SELECT DISTINCT linked_group_id FROM public.transaction_links
      WHERE status = 'linked' AND (manual_transaction_id = $1 OR plaid_transaction_record_id = $1)`,
    [id],
  );
  return res.rows.map((r) => r.linked_group_id);
}
