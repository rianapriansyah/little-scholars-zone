-- Rollback for 20261118010000_rename_employee_work_tables.sql: the tables, the status view, their
-- constraints, indexes, policies, the trigger function and every function body go back to the
-- classroom_teachers* names. No data is touched.
--
-- If 20261118020000 has already run, run its rollback first (it drops the pass-through views
-- this script expects to find and drop, and recreates them on rollback).
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261118010000_rename_employee_work_tables.sql

BEGIN;

DROP VIEW public.classroom_teachers_attendance_status;
DROP VIEW public.classroom_teachers_substitutions;
DROP VIEW public.classroom_teacher_work_sessions;
DROP VIEW public.classroom_teachers_attendances;
DROP VIEW public.classroom_teachers;

ALTER TABLE public.employee_assignments   RENAME TO classroom_teachers;
ALTER TABLE public.employee_attendances   RENAME TO classroom_teachers_attendances;
ALTER TABLE public.employee_work_sessions RENAME TO classroom_teacher_work_sessions;
ALTER TABLE public.employee_substitutions RENAME TO classroom_teachers_substitutions;
ALTER VIEW  public.employee_attendance_status RENAME TO classroom_teachers_attendance_status;

-- employee_assignment_rates / employee_assignment_schedules are separate words (singular
-- "assignment_"), so they never match these whole names.
CREATE FUNCTION pg_temp.old_name(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(n,
    'employee_attendances',   'classroom_teachers_attendances'),
    'employee_substitutions', 'classroom_teachers_substitutions'),
    'employee_work_sessions', 'classroom_teacher_work_sessions'),
    'employee_assignments',   'classroom_teachers')
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname FROM pg_constraint c
     WHERE c.connamespace = 'public'::regnamespace
       AND c.conname ~ 'employee_(attendances|substitutions|work_sessions|assignments)'
  LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, pg_temp.old_name(r.conname));
  END LOOP;

  FOR r IN
    SELECT i.indexname FROM pg_indexes i
     WHERE i.schemaname = 'public'
       AND i.indexname ~ 'employee_(attendances|substitutions|work_sessions|assignments)'
  LOOP
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.indexname, pg_temp.old_name(r.indexname));
  END LOOP;

  FOR r IN
    SELECT p.tablename, p.policyname FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.policyname ~ 'employee_(attendances|substitutions|work_sessions|assignments)'
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I RENAME TO %I', r.policyname, r.tablename, pg_temp.old_name(r.policyname));
  END LOOP;
END $$;

ALTER FUNCTION public.normalize_employee_attendance_times() RENAME TO normalize_classroom_teacher_attendance_times;

DO $$
DECLARE
  r   record;
  def text;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prosrc ~ '\m(employee_assignments|employee_attendances|employee_attendances_key|employee_work_sessions|employee_substitutions|employee_attendance_status)\M'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '\memployee_attendances_key\M',   'classroom_teachers_attendances_key',   'g');
    def := regexp_replace(def, '\memployee_attendance_status\M', 'classroom_teachers_attendance_status', 'g');
    def := regexp_replace(def, '\memployee_attendances\M',       'classroom_teachers_attendances',       'g');
    def := regexp_replace(def, '\memployee_substitutions\M',     'classroom_teachers_substitutions',     'g');
    def := regexp_replace(def, '\memployee_work_sessions\M',     'classroom_teacher_work_sessions',      'g');
    def := regexp_replace(def, '\memployee_assignments\M',       'classroom_teachers',                   'g');
    EXECUTE def;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
