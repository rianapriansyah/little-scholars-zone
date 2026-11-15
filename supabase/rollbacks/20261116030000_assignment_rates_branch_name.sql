-- Rollback for 20261116030000_assignment_rates_branch_name.sql: back to the Phase 1 view (no
-- branch_name; a view cannot drop a column in place, so it is recreated) and admin-only branches.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261116030000_assignment_rates_branch_name.sql

BEGIN;

DROP POLICY IF EXISTS employee_select_office_branch ON public.office_branch;

DROP VIEW public.employee_assignment_rates;

CREATE VIEW public.employee_assignment_rates
WITH (security_invoker = true) AS
SELECT
  ct.id         AS classroom_teacher_id,
  ct.teacher_id AS employee_id,
  CASE WHEN ct.work_item_id IS NOT NULL THEN 'work_item' ELSE 'program' END AS rate_source,
  w.id          AS work_item_id,
  p.id          AS program_id,
  coalesce(w.branch_id, p.branch_id)     AS branch_id,
  coalesce(w.name, p.name)               AS work_name,
  CASE WHEN ct.work_item_id IS NOT NULL THEN w.hourly_rate ELSE p.hourly_rate END AS hourly_rate
FROM public.classroom_teachers ct
LEFT JOIN public.work_items w ON w.id = ct.work_item_id
LEFT JOIN public.classrooms c ON c.id = ct.classroom_id
LEFT JOIN public.programs p ON p.id = c.program_id;

REVOKE ALL ON public.employee_assignment_rates FROM PUBLIC, anon;
GRANT SELECT ON public.employee_assignment_rates TO authenticated, service_role;

COMMIT;
