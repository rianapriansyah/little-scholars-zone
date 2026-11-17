-- Rollback for 20261118050000_flexi_hours_on_work_items.sql: flexible hours go back to each
-- assignment, "Daily Activity Work" is "Caregiving" again with its 4 evening assignments flexible,
-- and their 28 removed work sessions come back. Run 20261118060000's rollback first if it ran.
--
-- An assignment added after the migration keeps the flag its item gave it.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261118050000_flexi_hours_on_work_items.sql

BEGIN;

UPDATE public.employee_assignments ea SET is_flexi_hours = w.is_flexi_hours
  FROM public.work_items w WHERE w.id = ea.work_item_id AND ea.is_flexi_hours IS NULL;
UPDATE public.employee_assignments ea SET is_flexi_hours = b.is_flexi_hours
  FROM backup.assignment_flexi_20261118 b WHERE b.id = ea.id;
ALTER TABLE public.employee_assignments ADD CONSTRAINT employee_assignments_work_item_flexi_check
  CHECK ((work_item_id IS NULL) OR (is_flexi_hours IS NOT NULL));

-- Written back as they were; the attendance triggers are not involved (sessions only).
INSERT INTO public.employee_work_sessions SELECT * FROM backup.daily_activity_sessions_20261118;

UPDATE public.work_items SET name = 'Caregiving' WHERE id = '0523051e-14df-4f3f-8cfe-128d8462b797';

CREATE OR REPLACE VIEW public.employee_assignment_schedules WITH (security_invoker = true) AS
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

ALTER TABLE public.work_items DROP COLUMN is_flexi_hours;

DROP TABLE backup.daily_activity_sessions_20261118;
DROP TABLE backup.assignment_flexi_20261118;

NOTIFY pgrst, 'reload schema';

COMMIT;
