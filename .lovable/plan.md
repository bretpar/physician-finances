

## Fix: Transactions Not Persisting Deletes

### Problem
The Transactions page (`src/pages/Transactions.tsx`) operates entirely on **in-memory mock data**. Line 18 initializes state from `mockTransactions`, and the delete function (line 131) only removes from local state — it never calls the database. On reload, mock data reappears because nothing was actually deleted from the backend.

The `useTransactions` / `useDeleteTransaction` hooks exist in `src/hooks/useTransactions.ts` and correctly talk to the database, but the Transactions page doesn't use them.

### Plan

**1. Rewrite Transactions.tsx to use database hooks instead of local mock state**

- Replace `useState(mockTransactions)` with `useTransactions()` from the existing hook
- Replace the local `executeDelete()` with `useDeleteTransaction().mutate(id)`
- Replace local add logic with `useAddTransaction().mutate()`
- Replace local edit/save logic with `useUpdateTransaction().mutate()`
- Map `DbTransaction` fields (`vendor`, `transaction_date`, `account_source`) to the UI fields currently named (`merchant`, `date`, `account`)
- The `entity` and `companyType` fields don't exist in the DB `transactions` table yet — will need a migration to add `entity` (text, default 'Unassigned') and `company_type` (text, default '') columns

**2. Database migration — add entity columns to transactions table**

```sql
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS entity text NOT NULL DEFAULT 'Unassigned',
  ADD COLUMN IF NOT EXISTS company_type text NOT NULL DEFAULT '';
```

**3. Update summary widgets to use DB data**

- `useExpenseSummary` currently takes mock `Transaction[]` — update it to work with `DbTransaction[]` or the mapped format from the query results

**4. Ensure no auth required for now**

- Since the user hasn't added authentication yet, RLS will block all queries. The page likely shows empty data when hitting the DB. Either:
  - Add a note that auth is needed, OR
  - Temporarily add anon-access policies (not recommended for security)
- Most likely the user is already authenticated or we should flag this dependency

### Technical detail
- The `useDeleteTransaction` hook does a real `DELETE` (not soft-delete), which is correct
- Query invalidation in the hooks will automatically refresh summaries and the transaction list after mutations
- CSV export will continue to work since it operates on the filtered array

