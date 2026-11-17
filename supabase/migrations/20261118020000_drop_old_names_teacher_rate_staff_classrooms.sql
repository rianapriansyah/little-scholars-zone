-- Phase 4b of the employee-work refactor, the clean-up. Applied once the frontend build that uses
-- the employee_* names (20261118010000) is live on Vercel.
--
--   1. Drop the pass-through views that carried the old classroom_teachers* names.
--   2. Drop classrooms.teacher_rate. Pay reads programs.hourly_rate / work_items.hourly_rate
--      through employee_assignment_rates; nothing in the database or the app reads the column.
--   3. Delete the 9 staff-work classrooms (Piket, Konten, Aktivitas) that 20261116060000 emptied
--      and deactivated. Pinned to their ids; refused if any is active or still referenced.
--
-- What is removed is kept in backup.*_20261118 for the rollback:
--   supabase/rollbacks/20261118020000_drop_old_names_teacher_rate_staff_classrooms.sql

BEGIN;

CREATE TEMP TABLE staff_classroom_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO staff_classroom_ids VALUES
  ('809bb6e7-f624-45e8-a7cd-63ba5b8177bf'),  -- Piket Pagi Rumah Kecil
  ('1be0db6e-8479-4c15-9b16-d3c75f5259f3'),  -- Piket Pagi Bimba Pukul 07.00 - 08.00
  ('82020717-368e-4252-be55-1cabb141764d'),  -- Konten 08.00 - 20.30
  ('b9d0f41c-ba60-4ac1-b9b2-0372ec11eea4'),  -- Konten Pukul 10.00 - 12.00
  ('ddc08b9b-af07-41a6-be80-ab4a6230e215'),  -- Konten Pukul 13.30 - 15.30
  ('ccb8e096-e180-4279-8b1e-30caff64f378'),  -- Konten Pukul 15.30 - 17.30
  ('16530264-dca2-49be-b659-4f20ef78aa49'),  -- Konten Pukul 17.30 - 20.30
  ('659fae35-f9bb-447d-8e07-61023bedff27'),  -- Aktivitas Siang Rumah Kecil
  ('7884a8bf-1c2d-4de1-a18c-bb5cf2306c39');  -- Aktivitas Sore-Malam Rumah Kecil

-- ── Preconditions ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.classrooms c JOIN staff_classroom_ids s USING (id) WHERE NOT c.active;
  IF n <> 9 THEN
    RAISE EXCEPTION 'expected the 9 staff classrooms to exist and be inactive, found %', n;
  END IF;

  -- Tables carrying a classroom_id without a foreign key would not stop the delete: check them all.
  SELECT (SELECT count(*) FROM public.employee_assignments      WHERE classroom_id IN (SELECT id FROM staff_classroom_ids))
       + (SELECT count(*) FROM public.children_learning_periods WHERE classroom_id IN (SELECT id FROM staff_classroom_ids))
       + (SELECT count(*) FROM public.children_attendances      WHERE classroom_id IN (SELECT id FROM staff_classroom_ids))
       + (SELECT count(*) FROM public.children_daily_reports    WHERE classroom_id IN (SELECT id FROM staff_classroom_ids))
       + (SELECT count(*) FROM public.registration_children     WHERE classroom_id IN (SELECT id FROM staff_classroom_ids))
    INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION '% rows still point at a staff classroom', n;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ '\mteacher_rate\M')
     OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
                  AND pg_get_viewdef(c.oid) ~ '\mteacher_rate\M') THEN
    RAISE EXCEPTION 'something in the database still reads classrooms.teacher_rate';
  END IF;
END $$;

-- ── Backups ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE backup.classrooms_teacher_rate_20261118 AS
  SELECT id, teacher_rate FROM public.classrooms;
CREATE TABLE backup.staff_classrooms_20261118 AS
  SELECT c.* FROM public.classrooms c JOIN staff_classroom_ids s USING (id);

-- ── 1. Old-name views ───────────────────────────────────────────────────────────────────────
DROP VIEW public.classroom_teachers_attendance_status;
DROP VIEW public.classroom_teachers_substitutions;
DROP VIEW public.classroom_teacher_work_sessions;
DROP VIEW public.classroom_teachers_attendances;
DROP VIEW public.classroom_teachers;

-- ── 2. teacher_rate ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.classrooms DROP COLUMN teacher_rate;

-- ── 3. Staff classrooms ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  DELETE FROM public.classrooms WHERE id IN (SELECT id FROM staff_classroom_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 9 THEN
    RAISE EXCEPTION 'expected to delete 9 staff classrooms, deleted %', n;
  END IF;
  IF (SELECT count(*) FROM backup.staff_classrooms_20261118) <> 9 THEN
    RAISE EXCEPTION 'staff classroom backup is incomplete';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
