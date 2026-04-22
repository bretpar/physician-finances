CREATE POLICY "Owner fallback select transaction_attachments"
ON public.transaction_attachments
FOR SELECT
TO authenticated
USING ((auth.uid() = user_id) AND (organization_id IS NULL));