
CREATE TABLE public.mileage_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  year INTEGER NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  miles NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.mileage_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own mileage entries"
  ON public.mileage_entries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own mileage entries"
  ON public.mileage_entries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own mileage entries"
  ON public.mileage_entries FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own mileage entries"
  ON public.mileage_entries FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_mileage_entries_updated_at
  BEFORE UPDATE ON public.mileage_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
