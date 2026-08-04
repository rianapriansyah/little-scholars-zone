-- learning_periods rows are inserted straight from the admin screen rather than through a
-- SECURITY DEFINER RPC, so nothing was stamping created_by and every row landed with NULL.
--
-- Defaulting the column to auth.uid() puts the stamp where it cannot be forgotten, matching
-- how the RPC-created tables (children_classrooms, daily_reports) already behave.
ALTER TABLE public.learning_periods ALTER COLUMN created_by SET DEFAULT auth.uid();

COMMENT ON COLUMN public.learning_periods.created_by IS
  'The admin who sold/opened this period, defaulted from auth.uid() on insert. NULL only for '
  'rows created before this default existed, or by a service-role job with no end user.';
