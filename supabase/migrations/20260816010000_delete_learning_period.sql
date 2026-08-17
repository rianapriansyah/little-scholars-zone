-- Admin-only hard delete for the Periode Belajar grid: removes the payment_periods row and the
-- learning_periods row together, in one transaction, and hands the client back the receipt
-- path (if any) so it can delete the file from storage afterward — Postgres can't reach into
-- Storage itself.
--
-- payment_periods.learning_period_id references learning_periods(id), so it must be deleted
-- first or the second DELETE would violate that FK.
--
-- Deliberately does NOT touch child_attendances. child_attendances_period_fkey (from
-- 20260803010000_learning_periods_attendance.sql) has no ON DELETE clause, so a period with any
-- recorded attendance makes the second DELETE raise a foreign_key_violation (23503) and the
-- whole transaction rolls back — nothing is deleted, same "block it, don't cascade real history"
-- convention ClassroomDetailEditForm's delete already uses for classrooms with registration
-- history. The client maps that error code to a friendly message.

CREATE OR REPLACE FUNCTION public.delete_learning_period(p_learning_period_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt_path text;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorised to delete learning periods';
  END IF;

  SELECT receipt_path INTO v_receipt_path
    FROM public.payment_periods
    WHERE learning_period_id = p_learning_period_id;

  DELETE FROM public.payment_periods WHERE learning_period_id = p_learning_period_id;

  DELETE FROM public.learning_periods WHERE id = p_learning_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning period not found';
  END IF;

  RETURN v_receipt_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_learning_period(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_learning_period(uuid) TO authenticated, service_role;
