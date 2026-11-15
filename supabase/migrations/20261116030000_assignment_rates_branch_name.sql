-- Phase 2 of the employee work refactor: let the pay report split pay per branch.
--
-- The report now prices every assignment from employee_assignment_rates (20261116020000) and gives
-- one payslip per branch plus a total per person. For that it needs the branch's name next to each
-- rate, for teachers looking at their own pay as well as for the admin.
--
--   * office_branch: every employee may read the branch names (two rows, no personal data).
--     Until now only the admin could, as 20261113040000 noted a teacher policy would come "when a
--     screen needs it". Parents and anon still read nothing.
--   * employee_assignment_rates gains branch_name as its last column (CREATE OR REPLACE VIEW can
--     only append), so the existing columns and callers are untouched.
--
-- Rollback: supabase/rollbacks/20261116030000_assignment_rates_branch_name.sql

CREATE POLICY employee_select_office_branch ON public.office_branch FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.auth_user_id = auth.uid()));

CREATE OR REPLACE VIEW public.employee_assignment_rates
WITH (security_invoker = true) AS
SELECT
  ct.id         AS classroom_teacher_id,
  ct.teacher_id AS employee_id,
  CASE WHEN ct.work_item_id IS NOT NULL THEN 'work_item' ELSE 'program' END AS rate_source,
  w.id          AS work_item_id,
  p.id          AS program_id,
  coalesce(w.branch_id, p.branch_id)     AS branch_id,
  coalesce(w.name, p.name)               AS work_name,
  CASE WHEN ct.work_item_id IS NOT NULL THEN w.hourly_rate ELSE p.hourly_rate END AS hourly_rate,
  b.name        AS branch_name
FROM public.classroom_teachers ct
LEFT JOIN public.work_items w ON w.id = ct.work_item_id
LEFT JOIN public.classrooms c ON c.id = ct.classroom_id
LEFT JOIN public.programs p ON p.id = c.program_id
LEFT JOIN public.office_branch b ON b.id = coalesce(w.branch_id, p.branch_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.employee_assignment_rates WHERE hourly_rate IS NOT NULL AND branch_name IS NULL) THEN
    RAISE EXCEPTION 'An assignment with a rate has no branch name';
  END IF;
END;
$$;
