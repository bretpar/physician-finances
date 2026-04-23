-- Drop existing permissive policies on transaction-attachments bucket if present
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (policyname ILIKE '%transaction-attachments%' OR policyname ILIKE '%transaction_attachments%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Owner-only SELECT: path must start with user_id AND a matching attachment row owned by user must exist
CREATE POLICY "transaction-attachments owner select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'transaction-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND EXISTS (
    SELECT 1 FROM public.transaction_attachments ta
    WHERE ta.user_id = auth.uid()
      AND (ta.file_path = name OR ta.thumbnail_path = name)
  )
);

-- Owner-only INSERT: path must start with user_id
CREATE POLICY "transaction-attachments owner insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'transaction-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Owner-only UPDATE
CREATE POLICY "transaction-attachments owner update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'transaction-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'transaction-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Owner-only DELETE
CREATE POLICY "transaction-attachments owner delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'transaction-attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND EXISTS (
    SELECT 1 FROM public.transaction_attachments ta
    WHERE ta.user_id = auth.uid()
      AND (ta.file_path = name OR ta.thumbnail_path = name)
  )
);