-- Phase 3c of the employee work refactor: staff work leaves the classrooms table.
--
-- The 26 staff-work assignments (Piket, Konten, Aktivitas/Caregiving) still point at the 9
-- non-billable classrooms that were created only so they could clock in. Since 20261116040000 every
-- clock-in rule reads its schedule from the assignment's work item and own times, and since
-- 20261116050000 the app does too, so the classroom behind them is no longer used. This migration:
--
--   1. keeps a record of which classroom each staff assignment sat on
--      (backup.staff_assignment_classroom_20261116), for the rollback;
--   2. clears classroom_id on those 26 assignments (same ids, so every clock-in stays attached);
--   3. requires every assignment to be for exactly one of a class or a work item;
--   4. refuses placing a child on staff work (children_classrooms needs a class);
--   5. adds one Konten · Rucil assignment per Konten person (Miss Rani, Rian), so they can pick the
--      branch when they clock in;
--   6. deactivates the 9 staff classrooms (kept, not deleted, so old ids still resolve).
--
-- Not in this step: moving Miss Manda's and Miss Ima's 6 class assignments to Kasir/Caregiving,
-- which waits for the owner's rates (Phase 3d).
--
-- Checks at the end: counts, every attendance row's status and minutes unchanged, and pay per
-- employee per month unchanged by this step.
--
-- Rollback: supabase/rollbacks/20261116060000_staff_work_leaves_classrooms.sql

CREATE TEMP TABLE status_before ON COMMIT DROP AS
SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
FROM public.classroom_teachers_attendance_status;

-- Pay per employee per month at today's rates, just before this migration. Compared against at the
-- end rather than the 16 Nov baseline, because rates can legitimately have been changed in Kelola
-- Item Kerja since (Caregiving went from 5,000 to 8,000); what must hold is that THIS step changes
-- nobody's pay.
CREATE TEMP TABLE pay_before ON COMMIT DROP AS
SELECT ct.teacher_id AS employee_id, date_trunc('month', s.session_date) AS month,
       sum(coalesce(s.minutes_taught, 0) / 60.0 * r.hourly_rate) AS pay
FROM public.classroom_teachers_attendance_status s
JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
JOIN public.employee_assignment_rates r ON r.classroom_teacher_id = ct.id
GROUP BY 1, 2;

-- 1. Where each staff assignment sat.
CREATE TABLE backup.staff_assignment_classroom_20261116 AS
SELECT ct.id AS classroom_teacher_id, ct.classroom_id
FROM public.classroom_teachers ct
WHERE ct.work_item_id IS NOT NULL AND ct.classroom_id IS NOT NULL;
REVOKE ALL ON backup.staff_assignment_classroom_20261116 FROM PUBLIC, anon, authenticated;

-- 2. Staff work leaves its classroom.
UPDATE public.classroom_teachers SET classroom_id = NULL
WHERE work_item_id IS NOT NULL AND classroom_id IS NOT NULL;

-- 3. Exactly one of a class or a work item.
ALTER TABLE public.classroom_teachers DROP CONSTRAINT classroom_teachers_class_or_work_item_check;
ALTER TABLE public.classroom_teachers
  ADD CONSTRAINT classroom_teachers_class_xor_work_item_check
    CHECK (num_nonnulls(classroom_id, work_item_id) = 1);

-- 4. A child is placed with a teacher of a class, never on staff work.
CREATE FUNCTION public.children_classrooms_require_class()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.classroom_teachers ct
    WHERE ct.id = NEW.classroom_teacher_id AND ct.classroom_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Siswa hanya bisa ditempatkan di kelas, bukan di penugasan kerja';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER children_classrooms_require_class
  BEFORE INSERT OR UPDATE OF classroom_teacher_id ON public.children_classrooms
  FOR EACH ROW EXECUTE FUNCTION public.children_classrooms_require_class();

-- 5. Konten · Rucil: one per Konten person, with the times of their earliest Konten slot.
INSERT INTO public.classroom_teachers (teacher_id, classroom_id, work_item_id, time_start, time_end, is_flexi_hours)
SELECT DISTINCT ON (ct.teacher_id)
  ct.teacher_id, NULL, rucil_konten.id, ct.time_start, ct.time_end, ct.is_flexi_hours
FROM public.classroom_teachers ct
JOIN public.work_items bimba_konten ON bimba_konten.id = ct.work_item_id AND bimba_konten.name = 'Konten'
JOIN public.office_branch bb ON bb.id = bimba_konten.branch_id AND bb.name = 'Bimba Little Schoolars Zone'
CROSS JOIN LATERAL (
  SELECT w.id FROM public.work_items w JOIN public.office_branch b ON b.id = w.branch_id
  WHERE w.name = 'Konten' AND b.name = 'Rumah Main Rumah Kecil (Rucil)'
) rucil_konten
ORDER BY ct.teacher_id, ct.time_start;

-- 6. The staff classrooms are no longer used by anyone.
UPDATE public.classrooms c SET active = false
WHERE NOT c.is_billable
  AND c.id IN (SELECT classroom_id FROM backup.staff_assignment_classroom_20261116);

-- ── checks ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n bigint;
BEGIN
  IF (SELECT count(*) FROM backup.staff_assignment_classroom_20261116) <> 26 THEN
    RAISE EXCEPTION 'Expected 26 staff assignments to leave their classroom, got %',
      (SELECT count(*) FROM backup.staff_assignment_classroom_20261116);
  END IF;
  IF (SELECT count(*) FROM public.classroom_teachers) <> 79 THEN
    RAISE EXCEPTION 'Expected 77 assignments plus 2 Konten · Rucil, got %', (SELECT count(*) FROM public.classroom_teachers);
  END IF;
  IF (SELECT count(*) FROM public.classroom_teachers WHERE classroom_id IS NULL) <> 28 THEN
    RAISE EXCEPTION 'Expected 28 assignments without a classroom';
  END IF;
  IF (SELECT count(*) FROM public.classrooms WHERE NOT is_billable AND active) <> 0 THEN
    RAISE EXCEPTION 'A staff classroom is still active';
  END IF;

  -- No child sits on staff work.
  SELECT count(*) INTO n FROM public.children_classrooms cc
  JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
  WHERE ct.classroom_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% children are placed on staff work', n; END IF;

  -- Every clock-in still says exactly what it said.
  SELECT count(*) INTO n FROM (
    (SELECT * FROM status_before
     EXCEPT
     SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
     FROM public.classroom_teachers_attendance_status)
    UNION ALL
    (SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
     FROM public.classroom_teachers_attendance_status
     EXCEPT
     SELECT * FROM status_before)
  ) d;
  IF n > 0 THEN RAISE EXCEPTION 'Attendance status changed for % rows', n; END IF;

  -- Pay per employee per month is exactly what it was before this migration.
  SELECT count(*) INTO n FROM (
    SELECT coalesce(a.employee_id, b.employee_id) AS employee_id
    FROM pay_before a
    FULL JOIN (
      SELECT ct.teacher_id AS employee_id, date_trunc('month', s.session_date) AS month,
             sum(coalesce(s.minutes_taught, 0) / 60.0 * r.hourly_rate) AS pay
      FROM public.classroom_teachers_attendance_status s
      JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
      JOIN public.employee_assignment_rates r ON r.classroom_teacher_id = ct.id
      GROUP BY 1, 2
    ) b ON b.employee_id = a.employee_id AND b.month = a.month
    WHERE round(coalesce(a.pay, 0), 2) <> round(coalesce(b.pay, 0), 2)
  ) d;
  IF n > 0 THEN RAISE EXCEPTION 'Pay changed for % employee-months', n; END IF;
END;
$$;
