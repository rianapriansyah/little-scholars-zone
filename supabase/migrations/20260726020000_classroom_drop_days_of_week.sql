-- Classrooms always run Monday–Friday; the specific days no longer need to be tracked
-- per classroom, only the start (and end) time.
ALTER TABLE public.classrooms DROP CONSTRAINT IF EXISTS classrooms_days_of_week_valid;
ALTER TABLE public.classrooms DROP CONSTRAINT IF EXISTS classrooms_days_of_week_nonempty;
ALTER TABLE public.classrooms DROP COLUMN days_of_week;
