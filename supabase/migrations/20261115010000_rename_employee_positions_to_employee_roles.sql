-- Rename public.employee_positions → public.employee_roles.
--
-- ALTER TABLE ... RENAME is metadata-only: rows, grants, RLS policies and the foreign key from
-- employees.position_id are bound by OID and follow the table. What does not follow is text:
--   * the generated constraint/index names and the policy names, which still say "positions";
--   * the body of default_employee_position_id(), a plain-SQL function whose body is stored as
--     text and would fail once the old name is gone. It is recreated under a matching name and
--     employees.position_id's default is repointed to it before the old one is dropped.
--
-- Columns (employee_roles.position, employees.position_id) are intentionally left as they are.

ALTER TABLE public.employee_positions RENAME TO employee_roles;

-- Renaming a PRIMARY KEY / UNIQUE constraint renames its index with it.
ALTER TABLE public.employee_roles RENAME CONSTRAINT employee_positions_pkey TO employee_roles_pkey;
ALTER TABLE public.employee_roles RENAME CONSTRAINT employee_positions_position_key TO employee_roles_position_key;

ALTER POLICY admin_all_employee_positions ON public.employee_roles
  RENAME TO admin_all_employee_roles;
ALTER POLICY authenticated_select_employee_positions ON public.employee_roles
  RENAME TO authenticated_select_employee_roles;

CREATE OR REPLACE FUNCTION public.default_employee_role_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id FROM public.employee_roles WHERE position = 'Pengajar'
$$;

COMMENT ON FUNCTION public.default_employee_role_id() IS
  'The Pengajar role''s id — the default for employees.position_id, since every insert path '
  'today creates a teacher.';

ALTER TABLE public.employees
  ALTER COLUMN position_id SET DEFAULT public.default_employee_role_id();

DROP FUNCTION public.default_employee_position_id();

COMMENT ON TABLE public.employee_roles IS
  'What an employee is employed as — Pengajar, Pengasuh, Kasir, Admin. Formerly '
  '`employee_positions`. Referenced by employees.position_id. A job title only: it grants '
  'nothing. Access is still decided by the auth role in app_metadata, so changing someone''s '
  'role here never changes what they can open.';
