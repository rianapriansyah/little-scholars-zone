-- Rollback for 20261116060000_staff_work_leaves_classrooms.sql: staff work goes back on its old
-- classroom, from the record the migration kept.
--
-- Refuses if a Konten · Rucil assignment it added has been worked (its clock-ins would be lost),
-- or if another classroom-less assignment has been added since (Kelola Item Kerja): those have no
-- classroom to go back to, so they must be removed first.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261116060000_staff_work_leaves_classrooms.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.classroom_teachers ct
    WHERE ct.classroom_id IS NULL
      AND ct.id NOT IN (SELECT classroom_teacher_id FROM backup.staff_assignment_classroom_20261116)
      AND EXISTS (SELECT 1 FROM public.classroom_teachers_attendances a WHERE a.classroom_teacher_id = ct.id)
  ) THEN
    RAISE EXCEPTION 'A classroom-less assignment added after Phase 3c has clock-ins; resolve it by hand first';
  END IF;
END;
$$;

DROP TRIGGER children_classrooms_require_class ON public.children_classrooms;
DROP FUNCTION public.children_classrooms_require_class();

ALTER TABLE public.classroom_teachers DROP CONSTRAINT classroom_teachers_class_xor_work_item_check;

-- Assignments added since 3c (the Konten · Rucil ones, never worked) have no classroom to return to.
DELETE FROM public.classroom_teachers ct
WHERE ct.classroom_id IS NULL
  AND ct.id NOT IN (SELECT classroom_teacher_id FROM backup.staff_assignment_classroom_20261116);

UPDATE public.classroom_teachers ct SET classroom_id = s.classroom_id
FROM backup.staff_assignment_classroom_20261116 s
WHERE s.classroom_teacher_id = ct.id;

UPDATE public.classrooms SET active = true
WHERE id IN (SELECT classroom_id FROM backup.staff_assignment_classroom_20261116);

ALTER TABLE public.classroom_teachers
  ADD CONSTRAINT classroom_teachers_class_or_work_item_check
    CHECK (classroom_id IS NOT NULL OR work_item_id IS NOT NULL);

DROP TABLE backup.staff_assignment_classroom_20261116;

COMMIT;
