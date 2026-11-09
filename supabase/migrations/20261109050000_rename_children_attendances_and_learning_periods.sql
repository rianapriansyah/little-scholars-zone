-- Rename the attendance and learning-period tables so they read like the other per-child tables
-- (children, children_classrooms, children_daily_reports):
--   child_attendances -> children_attendances
--   learning_periods  -> children_learning_periods
--
-- Foreign keys, RLS policies, triggers, indexes and the learning_period_status view follow a table
-- rename on their own (they hold the table's oid). Function bodies are plain text, so every public
-- function that names either table is re-created from pg_get_functiondef with the names swapped.
-- Constraints, indexes, policies, triggers and the trigger functions named after a table are
-- renamed too, so nothing is left wearing the old name.
--
-- Kept as they are on purpose: RPC names the app calls (record_attendance, move_child_attendances,
-- delete_child_attendance, delete_child_attendance_with_report, delete_learning_period), column
-- names (learning_period_id, child_attendance_id), the learning_period_status view, and the
-- backup.* snapshot tables.
--
-- Rollout: the frontend on Vercel still asks for the old names until its new build is live, so
-- two thin pass-through views carry the old names for that window (security_invoker, so RLS on
-- the real tables still applies; simple views are insertable/updatable). 20261109060000 drops them
-- once the new build is deployed.

BEGIN;

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.child_attendances RENAME TO children_attendances;
ALTER TABLE public.learning_periods  RENAME TO children_learning_periods;

-- ── Constraints (renaming a unique/primary key renames its index too) ───────────────────────
ALTER TABLE public.children_attendances RENAME CONSTRAINT child_attendances_pkey                     TO children_attendances_pkey;
ALTER TABLE public.children_attendances RENAME CONSTRAINT child_attendances_child_classroom_date_key TO children_attendances_child_classroom_date_key;
ALTER TABLE public.children_attendances RENAME CONSTRAINT child_attendances_child_id_fkey            TO children_attendances_child_id_fkey;
ALTER TABLE public.children_attendances RENAME CONSTRAINT child_attendances_period_fkey              TO children_attendances_period_fkey;
ALTER TABLE public.children_attendances RENAME CONSTRAINT child_attendances_recorded_by_fkey         TO children_attendances_recorded_by_fkey;
ALTER TABLE public.children_attendances RENAME CONSTRAINT child_attendances_report_target_key        TO children_attendances_report_target_key;
ALTER TABLE public.children_attendances RENAME CONSTRAINT child_attendances_status_check             TO children_attendances_status_check;

ALTER TABLE public.children_learning_periods RENAME CONSTRAINT learning_periods_pkey                        TO children_learning_periods_pkey;
ALTER TABLE public.children_learning_periods RENAME CONSTRAINT learning_periods_child_classroom_period_no_key TO children_learning_periods_child_classroom_period_no_key;
ALTER TABLE public.children_learning_periods RENAME CONSTRAINT learning_periods_child_id_fkey               TO children_learning_periods_child_id_fkey;
ALTER TABLE public.children_learning_periods RENAME CONSTRAINT learning_periods_classroom_id_fkey           TO children_learning_periods_classroom_id_fkey;
ALTER TABLE public.children_learning_periods RENAME CONSTRAINT learning_periods_created_by_fkey             TO children_learning_periods_created_by_fkey;
ALTER TABLE public.children_learning_periods RENAME CONSTRAINT learning_periods_id_child_classroom_key      TO children_learning_periods_id_child_classroom_key;

-- ── Plain indexes ───────────────────────────────────────────────────────────────────────────
ALTER INDEX public.child_attendances_learning_period_id_idx RENAME TO children_attendances_learning_period_id_idx;
ALTER INDEX public.learning_periods_open_idx                RENAME TO children_learning_periods_open_idx;

-- ── RLS policies ────────────────────────────────────────────────────────────────────────────
ALTER POLICY admin_all_child_attendances                 ON public.children_attendances RENAME TO admin_all_children_attendances;
ALTER POLICY parent_select_own_child_attendances         ON public.children_attendances RENAME TO parent_select_own_children_attendances;
ALTER POLICY teacher_insert_child_attendances            ON public.children_attendances RENAME TO teacher_insert_children_attendances;
ALTER POLICY teacher_select_child_attendances            ON public.children_attendances RENAME TO teacher_select_children_attendances;
ALTER POLICY teacher_select_substituted_child_attendances ON public.children_attendances RENAME TO teacher_select_substituted_children_attendances;
ALTER POLICY teacher_update_child_attendances            ON public.children_attendances RENAME TO teacher_update_children_attendances;

ALTER POLICY admin_all_learning_periods                 ON public.children_learning_periods RENAME TO admin_all_children_learning_periods;
ALTER POLICY parent_select_own_learning_periods         ON public.children_learning_periods RENAME TO parent_select_own_children_learning_periods;
ALTER POLICY teacher_select_learning_periods            ON public.children_learning_periods RENAME TO teacher_select_children_learning_periods;
ALTER POLICY teacher_select_substituted_learning_periods ON public.children_learning_periods RENAME TO teacher_select_substituted_children_learning_periods;

-- ── Triggers and the trigger functions named after a table ──────────────────────────────────
ALTER TRIGGER child_attendances_refresh_period_active ON public.children_attendances
  RENAME TO children_attendances_refresh_period_active;
ALTER TRIGGER learning_periods_create_payment_period ON public.children_learning_periods
  RENAME TO children_learning_periods_create_payment_period;
ALTER TRIGGER learning_periods_set_active ON public.children_learning_periods
  RENAME TO children_learning_periods_set_active;
ALTER TRIGGER trg_learning_periods_guaranteed_days ON public.children_learning_periods
  RENAME TO trg_children_learning_periods_guaranteed_days;

ALTER FUNCTION public.child_attendances_refresh_period_active() RENAME TO children_attendances_refresh_period_active;
ALTER FUNCTION public.learning_periods_set_active()             RENAME TO children_learning_periods_set_active;
ALTER FUNCTION public.learning_periods_derive_guaranteed_days() RENAME TO children_learning_periods_derive_guaranteed_days;

-- ── Function bodies ─────────────────────────────────────────────────────────────────────────
-- \m...\M only matches the whole word, so move_child_attendances, learning_period_id and
-- backup.learning_periods_20261109 are left alone. CREATE OR REPLACE keeps grants, owner,
-- SECURITY DEFINER and search_path.
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
       AND p.prosrc ~ '\m(child_attendances|learning_periods)\M'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '\mchild_attendances\M', 'children_attendances', 'g');
    def := regexp_replace(def, '\mlearning_periods\M', 'children_learning_periods', 'g');
    EXECUTE def;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'rewrote % functions', n;
END $$;

-- ── Old names kept as pass-through views until the new frontend is live ─────────────────────
CREATE VIEW public.child_attendances WITH (security_invoker = true) AS
  SELECT * FROM public.children_attendances;
CREATE VIEW public.learning_periods WITH (security_invoker = true) AS
  SELECT * FROM public.children_learning_periods;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.child_attendances, public.learning_periods
  TO authenticated, service_role;

-- ── Checks ──────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  leftovers text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftovers
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND (p.prosrc ~ '\m(child_attendances|learning_periods)\M'
          OR p.proname ~ '^(child_attendances|learning_periods)_');
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'functions still using an old table name: %', leftovers;
  END IF;

  SELECT string_agg(conname, ', ') INTO leftovers FROM pg_constraint
   WHERE conname ~ '^(child_attendances|learning_periods)_';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'constraints still using an old name: %', leftovers;
  END IF;

  SELECT string_agg(policyname, ', ') INTO leftovers FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname ~ '(child_attendances|learning_periods)$'
     AND policyname !~ 'children_learning_periods$';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'policies still using an old name: %', leftovers;
  END IF;

  SELECT string_agg(indexname, ', ') INTO leftovers FROM pg_indexes
   WHERE schemaname = 'public' AND indexname ~ '^(child_attendances|learning_periods)_';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'indexes still using an old name: %', leftovers;
  END IF;

  SELECT string_agg(t.tgname, ', ') INTO leftovers FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgname ~ '^(trg_)?(child_attendances|learning_periods)_';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'triggers still using an old name: %', leftovers;
  END IF;

  IF pg_get_viewdef('public.learning_period_status'::regclass) !~ 'children_learning_periods' THEN
    RAISE EXCEPTION 'learning_period_status does not read children_learning_periods';
  END IF;
END $$;

COMMIT;
