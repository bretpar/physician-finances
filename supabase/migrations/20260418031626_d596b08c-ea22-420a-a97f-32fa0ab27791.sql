
-- Create transaction_attachments table
CREATE TABLE public.transaction_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  caption TEXT,
  thumbnail_path TEXT,
  extracted_vendor TEXT,
  extracted_amount NUMERIC,
  extracted_date DATE,
  ocr_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_transaction_attachments_transaction_id ON public.transaction_attachments(transaction_id);
CREATE INDEX idx_transaction_attachments_user_id ON public.transaction_attachments(user_id);
CREATE INDEX idx_transaction_attachments_organization_id ON public.transaction_attachments(organization_id);

ALTER TABLE public.transaction_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view org attachments"
  ON public.transaction_attachments FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT get_user_org_ids(auth.uid())));

CREATE POLICY "Users can create org attachments"
  ON public.transaction_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND organization_id IN (SELECT get_user_org_ids(auth.uid()))
  );

CREATE POLICY "Users can update own attachments"
  ON public.transaction_attachments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own attachments"
  ON public.transaction_attachments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_transaction_attachments_updated_at
  BEFORE UPDATE ON public.transaction_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create private storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('transaction-attachments', 'transaction-attachments', false);

-- Storage policies: files live under {user_id}/{transaction_id}/{filename}
CREATE POLICY "Users can view own attachment files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'transaction-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can upload own attachment files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'transaction-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own attachment files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'transaction-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own attachment files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'transaction-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
