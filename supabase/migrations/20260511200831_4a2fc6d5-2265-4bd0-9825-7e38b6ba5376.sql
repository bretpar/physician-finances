CREATE POLICY "Solo users can insert transaction attachments"
ON public.transaction_attachments
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);