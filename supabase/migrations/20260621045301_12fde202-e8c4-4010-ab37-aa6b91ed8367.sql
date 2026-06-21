-- Drop legacy plaintext access_token column from plaid_items (tokens live in Vault).
ALTER TABLE public.plaid_items DROP COLUMN IF EXISTS access_token;

-- Add owner-fallback SELECT policy so solo users (organization_id IS NULL)
-- can read their own plaid_items rows via RLS.
DROP POLICY IF EXISTS "Owner fallback select plaid_items" ON public.plaid_items;
CREATE POLICY "Owner fallback select plaid_items"
ON public.plaid_items
FOR SELECT
TO authenticated
USING (auth.uid() = user_id AND organization_id IS NULL);