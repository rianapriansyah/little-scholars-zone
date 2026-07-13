-- Classrooms can now meet on more than one day per week (same roster/capacity across all
-- of them, e.g. Mon/Wed/Fri), and track an end time alongside the existing start time.

ALTER TABLE public.classrooms ADD COLUMN days_of_week text[] NOT NULL DEFAULT '{}';
UPDATE public.classrooms SET days_of_week = ARRAY[day_of_week];
ALTER TABLE public.classrooms ALTER COLUMN days_of_week DROP DEFAULT;

ALTER TABLE public.classrooms ADD CONSTRAINT classrooms_days_of_week_valid
  CHECK (days_of_week <@ ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']::text[]);
ALTER TABLE public.classrooms ADD CONSTRAINT classrooms_days_of_week_nonempty
  CHECK (array_length(days_of_week, 1) > 0);

ALTER TABLE public.classrooms DROP COLUMN day_of_week;

ALTER TABLE public.classrooms ADD COLUMN time_end time;
