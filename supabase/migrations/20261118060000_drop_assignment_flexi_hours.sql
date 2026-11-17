-- Drop employee_assignments.is_flexi_hours. Since 20261118050000 flexible hours are the work
-- item's (work_items.is_flexi_hours) and the schedules view reads only that; the deployed app
-- (c22c369) neither reads nor writes the assignment column. Its values from before the move are in
-- backup.assignment_flexi_20261118.
--
-- Rollback: supabase/rollbacks/20261118060000_drop_assignment_flexi_hours.sql

BEGIN;

DO $$
BEGIN
  IF pg_get_viewdef('public.employee_assignment_schedules'::regclass) ~ 'ct\.is_flexi_hours' THEN
    RAISE EXCEPTION 'employee_assignment_schedules still reads the assignment flag';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND p.prosrc ~ '\m(ct|ea|employee_assignments)\.is_flexi_hours\M') THEN
    RAISE EXCEPTION 'a function still reads employee_assignments.is_flexi_hours';
  END IF;
END $$;

ALTER TABLE public.employee_assignments DROP COLUMN is_flexi_hours;

NOTIFY pgrst, 'reload schema';

COMMIT;
