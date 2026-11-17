-- Phase 4c of the employee-work refactor: drop classrooms.is_billable and classrooms.is_flexi_hours.
--
-- Both only existed so staff work (Piket, Konten, Aktivitas) could live in the classrooms table:
-- is_billable = false marked those fake classes, is_flexi_hours = true the Konten ones. Staff work
-- now lives in work_items, those classrooms are gone (20261118020000) and the owner confirmed there
-- will be no free classes, so every classroom is a paid class with fixed hours: all 13 rows are
-- is_billable = true, is_flexi_hours = false. Flexible hours stay, per assignment, on
-- employee_assignments.is_flexi_hours (Caregiving has both kinds).
--
--   * employee_assignment_schedules: is_flexi_hours = the assignment's flag for staff work, false
--     for a class; the is_billable column goes (the app reads "is a class" from classroom_id).
--     Dropped and re-created with employee_attendance_status, which depends on it; both keep
--     security_invoker, comments and grants.
--   * list_active_programs, substitutable_classes, create_children_with_first_periods stop
--     filtering on is_billable.
--
-- The deployed app (53d96e5) no longer reads or writes either column.
-- The old values, function and view definitions are kept in backup.*_20261118 for the rollback:
--   supabase/rollbacks/20261118040000_drop_classroom_billable_flexi.sql

BEGIN;

-- ── Preconditions ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.classrooms WHERE NOT is_billable OR is_flexi_hours) THEN
    RAISE EXCEPTION 'a classroom is non-billable or flexi; these columns still mean something';
  END IF;
END $$;

-- Fingerprints of what every clock-in rule and the pay report read, to prove nothing changes.
CREATE TEMP TABLE status_before ON COMMIT DROP AS
  SELECT md5(string_agg(s::text, '|' ORDER BY s.id)) AS h FROM public.employee_attendance_status s;
CREATE TEMP TABLE schedules_before ON COMMIT DROP AS
  SELECT md5(string_agg(row(s.classroom_teacher_id, s.employee_id, s.classroom_id, s.work_item_id, s.label,
                            s.time_start, s.time_end, s.is_flexi_hours, s.active)::text,
                        '|' ORDER BY s.classroom_teacher_id)) AS h
  FROM public.employee_assignment_schedules s;

-- ── Backups ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE backup.classrooms_flags_20261118 AS
  SELECT id, is_billable, is_flexi_hours FROM public.classrooms;

CREATE TABLE backup.billable_flexi_defs_20261118 (kind text, name text, def text);
INSERT INTO backup.billable_flexi_defs_20261118
  SELECT 'function', p.proname, pg_get_functiondef(p.oid)
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('list_active_programs', 'substitutable_classes', 'create_children_with_first_periods');
INSERT INTO backup.billable_flexi_defs_20261118 VALUES
  ('view', 'employee_assignment_schedules', pg_get_viewdef('public.employee_assignment_schedules'::regclass)),
  ('view', 'employee_attendance_status',    pg_get_viewdef('public.employee_attendance_status'::regclass)),
  ('comment', 'employee_assignment_schedules', obj_description('public.employee_assignment_schedules'::regclass, 'pg_class')),
  ('comment', 'employee_attendance_status',    obj_description('public.employee_attendance_status'::regclass, 'pg_class'));

-- ── Functions ───────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r     record;
  v_old text;
  v_new text;
BEGIN
  FOR r IN SELECT name, def FROM backup.billable_flexi_defs_20261118 WHERE kind = 'function' LOOP
    v_old := r.def;
    v_new := replace(replace(replace(replace(v_old,
      'WHERE id = v_classroom_id AND active AND is_billable', 'WHERE id = v_classroom_id AND active'),
      '-- Same rule as fetchActiveClassrooms: only real, fee-paying, active programs can be sold.',
      '-- Same rule as fetchActiveClassrooms: only active classes can be sold.'),
      'WHERE c.active AND c.is_billable', 'WHERE c.active'),
      E'    AND c.active\n    AND c.is_billable\n', E'    AND c.active\n');
    IF v_new = v_old OR v_new ~ 'is_billable' THEN
      RAISE EXCEPTION 'could not take is_billable out of %', r.name;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;

-- ── Views ───────────────────────────────────────────────────────────────────────────────────
DROP VIEW public.employee_attendance_status;
DROP VIEW public.employee_assignment_schedules;

CREATE VIEW public.employee_assignment_schedules WITH (security_invoker = true) AS
SELECT ct.id AS classroom_teacher_id,
       ct.teacher_id AS employee_id,
       ct.classroom_id,
       ct.work_item_id,
       CASE WHEN ct.work_item_id IS NOT NULL THEN (w.name || ' — ') || b.name ELSE c.label END AS label,
       CASE WHEN ct.work_item_id IS NOT NULL THEN ct.time_start ELSE c.time_start END AS time_start,
       CASE WHEN ct.work_item_id IS NOT NULL THEN ct.time_end ELSE c.time_end END AS time_end,
       -- A class always has fixed hours; staff work is flexible per assignment.
       CASE WHEN ct.work_item_id IS NOT NULL THEN ct.is_flexi_hours ELSE false END AS is_flexi_hours,
       CASE WHEN ct.work_item_id IS NOT NULL THEN w.active ELSE c.active END AS active
  FROM public.employee_assignments ct
  LEFT JOIN public.classrooms c ON c.id = ct.classroom_id
  LEFT JOIN public.work_items w ON w.id = ct.work_item_id
  LEFT JOIN public.office_branch b ON b.id = w.branch_id;

COMMENT ON VIEW public.employee_assignment_schedules IS
  'When and how each assignment is worked: label, times, flexi, active. Staff work reads its work '
  'item and its own times (flexible or not per assignment); teaching reads its class, always fixed '
  'hours. Every clock-in rule reads this view. security_invoker, so app callers see only the '
  'assignments their RLS allows.';

-- employee_attendance_status exactly as it was (its definition reads the schedules view by
-- column name), with security_invoker this time from the start.
DO $$
BEGIN
  EXECUTE 'CREATE VIEW public.employee_attendance_status WITH (security_invoker = true) AS '
    || (SELECT def FROM backup.billable_flexi_defs_20261118 WHERE kind = 'view' AND name = 'employee_attendance_status');
END $$;

COMMENT ON VIEW public.employee_attendance_status IS
  'employee_attendances plus the scheduled instants and flags derived from them. arrival_status/'
  'departure_status are flags only, never used to dock pay — payroll stays a manual process an '
  'admin runs off this data. security_invoker so the RLS of employee_attendances and the tables '
  'behind employee_assignment_schedules applies to readers of the view. Both statuses read '
  '''not_applicable'' for a flexible-hours assignment — there is no real schedule to be late or '
  'early against. minutes_taught is the sum of the day''s finished employee_work_sessions when it '
  'has any (so an unpaid break between two flexi sessions is excluded), and otherwise the plain '
  'clocked_out_at − clocked_in_at span.';

-- Same grants as before the re-create.
REVOKE ALL ON public.employee_assignment_schedules, public.employee_attendance_status
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON public.employee_assignment_schedules TO authenticated, service_role;
GRANT ALL ON public.employee_attendance_status TO anon, authenticated, service_role;

-- ── Columns ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.classrooms DROP COLUMN is_billable;
ALTER TABLE public.classrooms DROP COLUMN is_flexi_hours;

-- ── Checks ──────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  leftovers text;
BEGIN
  IF (SELECT h FROM status_before) IS DISTINCT FROM
       (SELECT md5(string_agg(s::text, '|' ORDER BY s.id)) FROM public.employee_attendance_status s) THEN
    RAISE EXCEPTION 'employee_attendance_status changed';
  END IF;
  IF (SELECT h FROM schedules_before) IS DISTINCT FROM
       (SELECT md5(string_agg(row(s.classroom_teacher_id, s.employee_id, s.classroom_id, s.work_item_id, s.label,
                                  s.time_start, s.time_end, s.is_flexi_hours, s.active)::text,
                              '|' ORDER BY s.classroom_teacher_id))
          FROM public.employee_assignment_schedules s) THEN
    RAISE EXCEPTION 'employee_assignment_schedules changed';
  END IF;

  SELECT string_agg(p.proname, ', ') INTO leftovers FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ '\mis_billable\M';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'functions still reading is_billable: %', leftovers;
  END IF;

  SELECT string_agg(c.relname, ', ') INTO leftovers FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
     AND NOT coalesce(c.reloptions::text ~ 'security_invoker=(true|on)', false);
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'views without security_invoker: %', leftovers;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
