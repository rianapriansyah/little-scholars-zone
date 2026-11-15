-- A rollback point before the employee work refactor (programs + work_items; staff work moves out
-- of classrooms). Phase 0 of the plan.
--
-- The project is on the free plan, which has no restorable backups, and the refactor rewrites the
-- tables behind clock-ins, pay and child placement. Every table it touches is copied as it stands,
-- in the same style as 20261108010000_backup_snapshot_reports_attendance.sql. A CSV copy of the
-- same tables is kept outside the database (backups/2026-11-16/, git-ignored).
--
-- pay_baseline_20261116 freezes what each assignment earned per month under today's rule
-- (minutes_taught from classroom_teachers_attendance_status x classrooms.teacher_rate, the same
-- arithmetic as src/lib/teacherAttendanceReport.ts). The refactor migrations compare against it:
-- pay must stay identical except for the six Kasir/Pengasuh class assignments that move on purpose.
--
-- The copies live in the `backup` schema, which PostgREST does not expose, and every grant to the
-- API roles is revoked: these rows include staff and family data. They are plain copies (no keys,
-- no RLS, no triggers). Drop them by hand only once the refactor has proven itself.

CREATE SCHEMA IF NOT EXISTS backup;
REVOKE ALL ON SCHEMA backup FROM PUBLIC, anon, authenticated;

CREATE TABLE backup.classrooms_20261116                      AS TABLE public.classrooms;
CREATE TABLE backup.classroom_teachers_20261116              AS TABLE public.classroom_teachers;
CREATE TABLE backup.classroom_teachers_attendances_20261116  AS TABLE public.classroom_teachers_attendances;
CREATE TABLE backup.classroom_teacher_work_sessions_20261116 AS TABLE public.classroom_teacher_work_sessions;
CREATE TABLE backup.classroom_teachers_substitutions_20261116 AS TABLE public.classroom_teachers_substitutions;
CREATE TABLE backup.children_classrooms_20261116             AS TABLE public.children_classrooms;
CREATE TABLE backup.children_learning_periods_20261116       AS TABLE public.children_learning_periods;
CREATE TABLE backup.children_daily_reports_20261116          AS TABLE public.children_daily_reports;
CREATE TABLE backup.employees_20261116                       AS TABLE public.employees;
CREATE TABLE backup.employee_roles_20261116                  AS TABLE public.employee_roles;
CREATE TABLE backup.office_branch_20261116                   AS TABLE public.office_branch;

CREATE TABLE backup.pay_baseline_20261116 AS
SELECT
  ct.id                                    AS classroom_teacher_id,
  ct.teacher_id                            AS employee_id,
  date_trunc('month', s.session_date)::date AS month,
  sum(coalesce(s.minutes_taught, 0))::int  AS minutes,
  c.teacher_rate                           AS rate_per_hour,
  sum(coalesce(s.minutes_taught, 0)) / 60.0 * c.teacher_rate AS pay
FROM public.classroom_teachers_attendance_status s
JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
JOIN public.classrooms c ON c.id = ct.classroom_id
GROUP BY ct.id, ct.teacher_id, date_trunc('month', s.session_date), c.teacher_rate;

REVOKE ALL ON ALL TABLES IN SCHEMA backup FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t text;
  live bigint;
  copy bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'classrooms', 'classroom_teachers', 'classroom_teachers_attendances',
    'classroom_teacher_work_sessions', 'classroom_teachers_substitutions', 'children_classrooms',
    'children_learning_periods', 'children_daily_reports', 'employees', 'employee_roles',
    'office_branch'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO live;
    EXECUTE format('SELECT count(*) FROM backup.%I', t || '_20261116') INTO copy;
    IF live <> copy THEN
      RAISE EXCEPTION 'Snapshot of % has % rows, live table has %', t, copy, live;
    END IF;
  END LOOP;

  -- Every clock-in day must be in the baseline.
  IF (SELECT count(*) FROM public.classroom_teachers_attendance_status) = 0
     OR (SELECT count(*) FROM backup.pay_baseline_20261116) = 0 THEN
    RAISE EXCEPTION 'Pay baseline is empty';
  END IF;
END;
$$;
