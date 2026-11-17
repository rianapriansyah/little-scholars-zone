-- Rollback for 20261118060000_drop_assignment_flexi_hours.sql: the column comes back, filled from
-- each assignment's work item (the value the schedules view uses), NULL for teaching.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261118060000_drop_assignment_flexi_hours.sql

BEGIN;

ALTER TABLE public.employee_assignments ADD COLUMN is_flexi_hours boolean;
UPDATE public.employee_assignments ea SET is_flexi_hours = w.is_flexi_hours
  FROM public.work_items w WHERE w.id = ea.work_item_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
