CREATE TABLE public.income_pathway_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID,
  previous_user_type TEXT NOT NULL,
  new_user_type TEXT NOT NULL,
  effective_date DATE NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  changed_by_user UUID NOT NULL,
  active_income_stream_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.income_pathway_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_income_pathway_history_user_effective_date
ON public.income_pathway_history (user_id, effective_date DESC);

CREATE INDEX idx_income_pathway_history_org_effective_date
ON public.income_pathway_history (organization_id, effective_date DESC)
WHERE organization_id IS NOT NULL;

CREATE POLICY "Users can view own pathway history"
ON public.income_pathway_history
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
);

CREATE POLICY "Users can create own pathway history"
ON public.income_pathway_history
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND changed_by_user = auth.uid()
  AND (
    organization_id IS NULL
    OR organization_id IN (SELECT public.get_user_org_ids(auth.uid()))
  )
);
