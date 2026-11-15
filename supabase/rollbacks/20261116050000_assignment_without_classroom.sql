-- Rollback for 20261116050000_assignment_without_classroom.sql: classroom_id required again.
-- Refuses while any assignment has no classroom (work-item assignments added in Kelola Item Kerja,
-- or Phase 3c): remove or roll those back first.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261116050000_assignment_without_classroom.sql

BEGIN;

ALTER TABLE public.classroom_teachers DROP CONSTRAINT classroom_teachers_class_or_work_item_check;
ALTER TABLE public.classroom_teachers ALTER COLUMN classroom_id SET NOT NULL;

COMMIT;
