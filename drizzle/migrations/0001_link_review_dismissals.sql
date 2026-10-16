CREATE TABLE public.link_review_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  item_key text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_key)
);
GRANT SELECT, INSERT, DELETE ON public.link_review_dismissals TO authenticated;
GRANT ALL ON public.link_review_dismissals TO service_role;
ALTER TABLE public.link_review_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own dismissals select" ON public.link_review_dismissals FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own dismissals insert" ON public.link_review_dismissals FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own dismissals delete" ON public.link_review_dismissals FOR DELETE TO authenticated USING (user_id = auth.uid());