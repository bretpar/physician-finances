-- Replace bad NULLS NOT DISTINCT unique constraints on planner_conversions with
-- partial unique indexes so multiple normal paychecks (bonus_event_id IS NULL)
-- can be converted without violating uniqueness, while still preventing
-- duplicate conversions for the same stream/date or the same bonus event.

ALTER TABLE public.planner_conversions
  DROP CONSTRAINT IF EXISTS planner_conversions_unique_bonus,
  DROP CONSTRAINT IF EXISTS planner_conversions_unique_stream_occurrence;

DROP INDEX IF EXISTS public.planner_conversions_unique_bonus;
DROP INDEX IF EXISTS public.planner_conversions_unique_stream_occurrence;

CREATE UNIQUE INDEX IF NOT EXISTS planner_conversions_unique_stream_occurrence
  ON public.planner_conversions (stream_id, occurrence_date)
  WHERE stream_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS planner_conversions_unique_bonus_event
  ON public.planner_conversions (bonus_event_id)
  WHERE bonus_event_id IS NOT NULL;