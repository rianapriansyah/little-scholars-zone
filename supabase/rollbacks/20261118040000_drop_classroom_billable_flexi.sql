-- Rollback for 20261118040000_drop_classroom_billable_flexi.sql: classrooms.is_billable and
-- classrooms.is_flexi_hours come back with their values, defaults and comments; the three
-- functions and both views are re-created from the definitions the migration saved.
-- Classrooms created after the migration get the defaults (billable, fixed hours).
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261118040000_drop_classroom_billable_flexi.sql

BEGIN;

ALTER TABLE public.classrooms ADD COLUMN is_billable boolean NOT NULL DEFAULT true;
ALTER TABLE public.classrooms ADD COLUMN is_flexi_hours boolean NOT NULL DEFAULT false;
UPDATE public.classrooms c SET is_billable = b.is_billable, is_flexi_hours = b.is_flexi_hours
  FROM backup.classrooms_flags_20261118 b WHERE b.id = c.id;

COMMENT ON COLUMN public.classrooms.is_billable IS 'true = a real fee-paying class a family enrolls a child into (the historical, and still default, meaning of a classroom row). false = an internal work program nobody pays for (cleaning duty, content creation) that only exists so teachers/staff can clock in/out of it through the same mechanism as real teaching. Every "what programs can a family enroll into" query (list_active_programs, fetchActiveClassrooms, the admin classroom count) must filter on this — a non-billable program must never be offered as something to enroll a child in.';
COMMENT ON COLUMN public.classrooms.is_flexi_hours IS 'true = this classroom/program has no real schedule to clock in/out against — clock_in_classroom_teacher/clock_out_classroom_teacher skip their time-window checks entirely, and classroom_teachers_attendance_status reports arrival_status/departure_status as ''not_applicable'' rather than computing lateness against a nominal time_start/time_end. time_start/time_end are still required (NOT NULL) and still shown for display, but not enforced. Piket Kebersihan Kelas stays false (it has a real 07:00-08:00 window); Pembuatan Konten is true.';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT def FROM backup.billable_flexi_defs_20261118 WHERE kind = 'function' LOOP
    EXECUTE r.def;
  END LOOP;

  EXECUTE 'DROP VIEW public.employee_attendance_status';
  EXECUTE 'DROP VIEW public.employee_assignment_schedules';
  EXECUTE 'CREATE VIEW public.employee_assignment_schedules WITH (security_invoker = true) AS '
    || (SELECT def FROM backup.billable_flexi_defs_20261118 WHERE kind = 'view' AND name = 'employee_assignment_schedules');
  EXECUTE 'CREATE VIEW public.employee_attendance_status WITH (security_invoker = true) AS '
    || (SELECT def FROM backup.billable_flexi_defs_20261118 WHERE kind = 'view' AND name = 'employee_attendance_status');
END $$;

DO $$
BEGIN
  EXECUTE format('COMMENT ON VIEW public.employee_assignment_schedules IS %L',
    (SELECT def FROM backup.billable_flexi_defs_20261118 WHERE kind = 'comment' AND name = 'employee_assignment_schedules'));
  EXECUTE format('COMMENT ON VIEW public.employee_attendance_status IS %L',
    (SELECT def FROM backup.billable_flexi_defs_20261118 WHERE kind = 'comment' AND name = 'employee_attendance_status'));
END $$;

REVOKE ALL ON public.employee_assignment_schedules, public.employee_attendance_status
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.employee_assignment_schedules TO authenticated, service_role;
GRANT ALL ON public.employee_attendance_status TO anon, authenticated, service_role;

DROP TABLE backup.billable_flexi_defs_20261118;
DROP TABLE backup.classrooms_flags_20261118;

NOTIFY pgrst, 'reload schema';

COMMIT;
