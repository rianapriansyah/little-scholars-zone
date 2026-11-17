-- Phase 4a of the employee-work refactor: the tables are named for what they now hold. An
-- assignment is a person on a class OR on a work item (Piket, Konten, Caregiving...), so
-- "classroom_teachers" no longer fits.
--
--   classroom_teachers                   -> employee_assignments
--   classroom_teachers_attendances       -> employee_attendances
--   classroom_teacher_work_sessions      -> employee_work_sessions
--   classroom_teachers_substitutions     -> employee_substitutions
--   classroom_teachers_attendance_status -> employee_attendance_status   (view)
--
-- Same approach as 20261109050000: foreign keys, RLS policies, triggers, indexes and views follow
-- a rename on their own (they hold the oid). Function bodies are text, so every public function
-- naming an old table (or the constraint classroom_teachers_attendances_key, used in ON CONFLICT)
-- is re-created from pg_get_functiondef with the names swapped. Constraints, indexes, policies and
-- the trigger function named after a table are renamed so nothing keeps the old name.
--
-- Kept on purpose (renaming them would touch every screen for no behaviour change):
--   * column names: classroom_teacher_id, teacher_id;
--   * RPC names the app calls: clock_in_classroom_teacher, clock_out_classroom_teacher,
--     clock_out_and_continue_classroom_teacher, delete_classroom_teacher_assignment, ...;
--   * the backup.* snapshot tables.
--
-- Rollout: the build on Vercel asks for the old names until the new one is live, so thin
-- security_invoker pass-through views carry the old names for that window (RLS on the real tables
-- still applies; simple views are insertable/updatable). 20261118020000 drops them.
--
-- Rollback: supabase/rollbacks/20261118010000_rename_employee_work_tables.sql

BEGIN;

-- Fingerprint of everything pay and status read, to prove the rename changes no data.
CREATE TEMP TABLE status_before ON COMMIT DROP AS
  SELECT md5(string_agg(s::text, '|' ORDER BY s.id)) AS h, count(*) AS n
  FROM public.classroom_teachers_attendance_status s;
CREATE TEMP TABLE rates_before ON COMMIT DROP AS
  SELECT md5(string_agg(r::text, '|' ORDER BY r.classroom_teacher_id)) AS h, count(*) AS n
  FROM public.employee_assignment_rates r;

-- ── Tables and the status view ──────────────────────────────────────────────────────────────
ALTER TABLE public.classroom_teachers               RENAME TO employee_assignments;
ALTER TABLE public.classroom_teachers_attendances   RENAME TO employee_attendances;
ALTER TABLE public.classroom_teacher_work_sessions  RENAME TO employee_work_sessions;
ALTER TABLE public.classroom_teachers_substitutions RENAME TO employee_substitutions;
ALTER VIEW  public.classroom_teachers_attendance_status RENAME TO employee_attendance_status;

-- ── Constraints, plain indexes and policies, by the same name map ───────────────────────────
-- Longest names first, so classroom_teachers_attendances is not caught as classroom_teachers.
-- The singular classroom_teacher_ (column names inside constraint names, e.g.
-- children_classrooms_classroom_teacher_id_fkey) never matches.
CREATE FUNCTION pg_temp.new_name(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(n,
    'classroom_teachers_attendances',   'employee_attendances'),
    'classroom_teachers_substitutions', 'employee_substitutions'),
    'classroom_teacher_work_sessions',  'employee_work_sessions'),
    'classroom_teachers',               'employee_assignments')
$$;

DO $$
DECLARE
  r record;
BEGIN
  -- Renaming a unique/primary-key constraint renames its index too.
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
      FROM pg_constraint c
     WHERE c.connamespace = 'public'::regnamespace
       AND c.conname ~ 'classroom_teachers|classroom_teacher_work_sessions'
  LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, pg_temp.new_name(r.conname));
  END LOOP;

  FOR r IN
    SELECT i.indexname
      FROM pg_indexes i
     WHERE i.schemaname = 'public'
       AND i.indexname ~ 'classroom_teachers|classroom_teacher_work_sessions'
  LOOP
    EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.indexname, pg_temp.new_name(r.indexname));
  END LOOP;

  FOR r IN
    SELECT p.tablename, p.policyname
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.policyname ~ 'classroom_teachers|classroom_teacher_work_sessions'
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I RENAME TO %I', r.policyname, r.tablename, pg_temp.new_name(r.policyname));
  END LOOP;
END $$;

-- The trigger function named after the old table (triggers hold its oid, so they follow).
ALTER FUNCTION public.normalize_classroom_teacher_attendance_times() RENAME TO normalize_employee_attendance_times;

-- ── Function bodies ─────────────────────────────────────────────────────────────────────────
-- \m...\M only matches the whole word, so classroom_teacher_id, p_classroom_teacher_id,
-- clock_in_classroom_teacher and teacher_classroom_teacher_ids are left alone. CREATE OR REPLACE
-- keeps grants, owner, SECURITY DEFINER and search_path.
DO $$
DECLARE
  r   record;
  def text;
  n   int := 0;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prosrc ~ '\m(classroom_teachers|classroom_teachers_attendances|classroom_teachers_attendances_key|classroom_teacher_work_sessions|classroom_teachers_substitutions|classroom_teachers_attendance_status)\M'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '\mclassroom_teachers_attendances_key\M',    'employee_attendances_key',   'g');
    def := regexp_replace(def, '\mclassroom_teachers_attendance_status\M',  'employee_attendance_status', 'g');
    def := regexp_replace(def, '\mclassroom_teachers_attendances\M',        'employee_attendances',       'g');
    def := regexp_replace(def, '\mclassroom_teachers_substitutions\M',      'employee_substitutions',     'g');
    def := regexp_replace(def, '\mclassroom_teacher_work_sessions\M',       'employee_work_sessions',     'g');
    def := regexp_replace(def, '\mclassroom_teachers\M',                    'employee_assignments',       'g');
    EXECUTE def;
    n := n + 1;
  END LOOP;
  IF n < 30 THEN
    RAISE EXCEPTION 'expected about 33 functions to rewrite, rewrote %', n;
  END IF;
  RAISE NOTICE 'rewrote % functions', n;
END $$;

-- ── Old names kept as pass-through views until the new frontend is live ─────────────────────
CREATE VIEW public.classroom_teachers WITH (security_invoker = true) AS
  SELECT * FROM public.employee_assignments;
CREATE VIEW public.classroom_teachers_attendances WITH (security_invoker = true) AS
  SELECT * FROM public.employee_attendances;
CREATE VIEW public.classroom_teacher_work_sessions WITH (security_invoker = true) AS
  SELECT * FROM public.employee_work_sessions;
CREATE VIEW public.classroom_teachers_substitutions WITH (security_invoker = true) AS
  SELECT * FROM public.employee_substitutions;
CREATE VIEW public.classroom_teachers_attendance_status WITH (security_invoker = true) AS
  SELECT * FROM public.employee_attendance_status;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.classroom_teachers, public.classroom_teachers_attendances,
  public.classroom_teacher_work_sessions, public.classroom_teachers_substitutions
  TO authenticated, service_role;
GRANT SELECT ON public.classroom_teachers_attendance_status TO authenticated, service_role;

-- ── Checks ──────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  leftovers text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftovers
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.prosrc ~ '\m(classroom_teachers|classroom_teachers_attendances|classroom_teachers_attendances_key|classroom_teacher_work_sessions|classroom_teachers_substitutions|classroom_teachers_attendance_status)\M';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'functions still using an old table name: %', leftovers;
  END IF;

  SELECT string_agg(conname, ', ') INTO leftovers FROM pg_constraint
   WHERE connamespace = 'public'::regnamespace AND conname ~ 'classroom_teachers|classroom_teacher_work_sessions';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'constraints still using an old name: %', leftovers;
  END IF;

  SELECT string_agg(indexname, ', ') INTO leftovers FROM pg_indexes
   WHERE schemaname = 'public' AND indexname ~ 'classroom_teachers|classroom_teacher_work_sessions';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'indexes still using an old name: %', leftovers;
  END IF;

  SELECT string_agg(policyname, ', ') INTO leftovers FROM pg_policies
   WHERE schemaname = 'public' AND policyname ~ 'classroom_teachers|classroom_teacher_work_sessions';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'policies still using an old name: %', leftovers;
  END IF;

  IF pg_get_viewdef('public.employee_assignment_schedules'::regclass) !~ 'employee_assignments'
     OR pg_get_viewdef('public.employee_assignment_rates'::regclass) !~ 'employee_assignments'
     OR pg_get_viewdef('public.employee_attendance_status'::regclass) !~ 'employee_attendances' THEN
    RAISE EXCEPTION 'a view does not read the renamed tables';
  END IF;

  IF (SELECT h FROM status_before) IS DISTINCT FROM
       (SELECT md5(string_agg(s::text, '|' ORDER BY s.id)) FROM public.employee_attendance_status s)
     OR (SELECT h FROM status_before) IS DISTINCT FROM
       (SELECT md5(string_agg(s::text, '|' ORDER BY s.id)) FROM public.classroom_teachers_attendance_status s)
     OR (SELECT h FROM rates_before) IS DISTINCT FROM
       (SELECT md5(string_agg(r::text, '|' ORDER BY r.classroom_teacher_id)) FROM public.employee_assignment_rates r) THEN
    RAISE EXCEPTION 'attendance status or rates changed across the rename';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
