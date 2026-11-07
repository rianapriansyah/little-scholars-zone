-- Deleting a learning period must never take its absensi with it.
--
-- 20260816010000_delete_learning_period.sql was written knowing that child_attendances_period_fkey
-- had no ON DELETE rule, so a period with any recorded absensi could not be deleted — the second
-- DELETE in the RPC would hit a foreign_key_violation. Nine days later
-- 20260825010000_family_cascade_delete.sql switched that same FK to ON DELETE CASCADE so that
-- deleting a family would work. From then on delete_learning_period quietly took every absensi row
-- of the period with it, and its payment row too.
--
-- That is how one child (87b8984a…) lost periods #1 and #2 some time between 4 Nov 01:23 and
-- 5 Nov 05:14 UTC: their absensi went with them, and 18 daily reports — written against those very
-- days — were left pointing at nothing. The free plan has no backup to restore them from.
--
-- The fix keeps family deletion working without the cascade:
--
--   1. child_attendances gets its own FK to children, ON DELETE CASCADE. Deleting a child (or a
--      family, which cascades to children) removes their absensi through the child, the way
--      children_daily_reports and payment_periods already are.
--   2. child_attendances_period_fkey goes back to NO ACTION, DEFERRABLE INITIALLY DEFERRED. The
--      check runs at commit: by then a family delete has removed the absensi through (1) and
--      passes, while deleting one period that still has absensi fails — whichever path it comes
--      from, the RPC below or a direct DELETE through the admin's RLS policy.
--   3. delete_learning_period refuses up front, so the admin gets a sentence instead of an FK
--      error at commit.

-- Rows before the change, compared at the end. Nothing in this migration may remove a row.
CREATE TEMP TABLE _counts_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.child_attendances) AS attendances,
  (SELECT count(*) FROM public.learning_periods) AS periods,
  (SELECT count(*) FROM public.payment_periods) AS payments;

-- 1. Absensi follows its child.
ALTER TABLE public.child_attendances
  ADD CONSTRAINT child_attendances_child_id_fkey
  FOREIGN KEY (child_id) REFERENCES public.children(id) ON DELETE CASCADE;

-- 2. A period with absensi cannot be deleted on its own.
ALTER TABLE public.child_attendances DROP CONSTRAINT child_attendances_period_fkey;

ALTER TABLE public.child_attendances
  ADD CONSTRAINT child_attendances_period_fkey
  FOREIGN KEY (learning_period_id, child_id, classroom_id)
  REFERENCES public.learning_periods (id, child_id, classroom_id)
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT child_attendances_period_fkey ON public.child_attendances IS
  'Deliberately NO ACTION, deferred — never CASCADE. A learning period with absensi must not be '
  'deletable on its own: CASCADE here once erased two periods of absensi and orphaned 18 daily '
  'reports. Family/child deletion still works because child_attendances_child_id_fkey removes the '
  'absensi through the child before this is checked at commit.';

-- 3. The RPC says why.
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

  -- Only a period nobody has attended can go. Its absensi is the quota history and the daily
  -- reports hang off it; child_attendances_period_fkey refuses this at commit regardless, this
  -- just says so in words before anything is touched.
  IF EXISTS (
    SELECT 1 FROM public.child_attendances WHERE learning_period_id = p_learning_period_id
  ) THEN
    RAISE EXCEPTION 'Periode belajar ini sudah memiliki absensi, sehingga tidak dapat dihapus';
  END IF;

  SELECT receipt_path INTO v_receipt_path
    FROM public.payment_periods
    WHERE learning_period_id = p_learning_period_id;

  DELETE FROM public.payment_periods WHERE learning_period_id = p_learning_period_id;

  DELETE FROM public.learning_periods WHERE id = p_learning_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning period not found';
  END IF;

  -- The caller removes the receipt file from Storage only after this has returned.
  RETURN v_receipt_path;
END;
$$;

COMMENT ON FUNCTION public.delete_learning_period(uuid) IS
  'Admin only. Deletes an unused learning period and its payment row, returning the receipt path '
  'for the client to remove from Storage afterwards. Refuses any period that has absensi.';

DO $$
DECLARE
  b record;
BEGIN
  SELECT * INTO b FROM _counts_before;
  IF (SELECT count(*) FROM public.child_attendances) <> b.attendances
     OR (SELECT count(*) FROM public.learning_periods) <> b.periods
     OR (SELECT count(*) FROM public.payment_periods) <> b.payments
  THEN
    RAISE EXCEPTION 'Row counts changed during the migration';
  END IF;
END;
$$;
