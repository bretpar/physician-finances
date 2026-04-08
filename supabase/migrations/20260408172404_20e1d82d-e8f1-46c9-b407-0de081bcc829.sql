
CREATE TABLE public.plaid_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  institution_name TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL,
  item_id TEXT NOT NULL,
  cursor TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own plaid items"
ON public.plaid_items FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own plaid items"
ON public.plaid_items FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own plaid items"
ON public.plaid_items FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own plaid items"
ON public.plaid_items FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_plaid_items_user ON public.plaid_items (user_id);

CREATE TRIGGER update_plaid_items_updated_at
BEFORE UPDATE ON public.plaid_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
