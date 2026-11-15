-- Rollback for 20261116020000_programs_and_work_items.sql.
--
-- Phase 1 only added things, so undoing it only removes them; no existing row or column is touched.
-- Safe to run as long as Phase 3 has not moved any assignment off its classroom (it checks).
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261116020000_programs_and_work_items.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.classroom_teachers WHERE classroom_id IS NULL) THEN
    RAISE EXCEPTION 'Assignments without a classroom exist: Phase 3 has run, roll that back first';
  END IF;
END;
$$;

-- The teacher read policies reference the new columns, so they go first.
DROP POLICY IF EXISTS teacher_select_own_work_items ON public.work_items;
DROP POLICY IF EXISTS teacher_select_own_programs ON public.programs;

DROP VIEW IF EXISTS public.employee_assignment_rates;

ALTER TABLE public.classroom_teachers
  DROP CONSTRAINT IF EXISTS classroom_teachers_work_item_times_check,
  DROP COLUMN IF EXISTS work_item_id,
  DROP COLUMN IF EXISTS time_start,
  DROP COLUMN IF EXISTS time_end;

ALTER TABLE public.classrooms DROP COLUMN IF EXISTS program_id;

DROP TABLE IF EXISTS public.work_items;
DROP TABLE IF EXISTS public.programs;

COMMIT;
