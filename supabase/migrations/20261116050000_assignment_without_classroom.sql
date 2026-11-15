-- Phase 3b of the employee work refactor: an assignment may be staff work with no classroom.
--
-- Kelola Item Kerja can now assign a person to a work item (Kasir, Caregiving, Piket...) with
-- their own times, which needs classroom_teachers.classroom_id to be optional. Compatible with
-- everything in production: no existing row changes, and every clock-in rule and screen already
-- reads its schedule from employee_assignment_schedules (20261116040000), which handles both.
--
-- Interim rule: an assignment is for a class, or for a work item, or (only the 26 staff-work rows
-- still sitting on their old classroom) both. Phase 3c clears those classrooms and tightens this to
-- exactly one.
--
-- Rollback: supabase/rollbacks/20261116050000_assignment_without_classroom.sql

ALTER TABLE public.classroom_teachers ALTER COLUMN classroom_id DROP NOT NULL;

ALTER TABLE public.classroom_teachers
  ADD CONSTRAINT classroom_teachers_class_or_work_item_check
    CHECK (classroom_id IS NOT NULL OR work_item_id IS NOT NULL);
