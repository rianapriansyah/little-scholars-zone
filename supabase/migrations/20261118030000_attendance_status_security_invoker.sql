-- Put security_invoker back on employee_attendance_status.
--
-- 20261116040000 rewrote the view (then classroom_teachers_attendance_status) with CREATE OR
-- REPLACE VIEW and no WITH clause, which resets the view's options: it lost the
-- security_invoker = true every earlier version had. Since then it read employee_attendances and
-- employee_assignments with its owner's rights, so the only filter left was the RLS on the
-- (security_invoker) schedules view it joins: any logged-in user saw the clock-ins of every
-- assignment they can see. Measured before this fix: a parent saw 267 teacher clock-in rows
-- (their children's teachers), a teacher 170 rows instead of their own 133. Anonymous callers
-- were refused (no grant on work_items).
--
-- With the option back, the view applies the attendance RLS again: admins see all, a teacher only
-- her own clock-ins, a parent none. supabase/tests/views_security_invoker.test.sql now fails if any
-- public view is missing the option.
--
-- Rollback: supabase/rollbacks/20261118030000_attendance_status_security_invoker.sql

BEGIN;

ALTER VIEW public.employee_attendance_status SET (security_invoker = true);

DO $$
DECLARE
  leftovers text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO leftovers
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
     AND NOT coalesce(c.reloptions::text ~ 'security_invoker=(true|on)', false);
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'views without security_invoker: %', leftovers;
  END IF;
END $$;

COMMIT;
