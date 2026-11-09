-- Pindahkan Absen: move attendance days from one learning period to another.
--
-- Before every period was entered, record_attendance() could only file a day against whichever
-- period was open at the time, so days landed on the wrong block. Once the right periods exist the
-- days are correct in themselves — only learning_period_id is wrong — so this re-points them
-- rather than deleting and re-recording (which a filed daily report would refuse anyway).
--
-- Additive only: one new function, no data touched by the migration itself.
--
-- Rules:
--   * Admin only.
--   * Every day must belong to the target period's child and classroom.
--     child_attendances_period_fkey (learning_period_id, child_id, classroom_id) enforces this at
--     commit regardless; checking first gives a readable message.
--   * The target may not end up with more consuming (non-sakit) days than its guaranteed_days —
--     days_remaining would go negative.
--   * Each affected period's closure is recomputed with the same rule delete_child_attendance
--     uses: full → closed on the day that consumed the last slot. Below quota it is reopened only
--     if the quota was what had closed it; a period closed by hand (Tandai Selesai) stays closed.

CREATE OR REPLACE FUNCTION public.move_child_attendances(
  p_attendance_ids uuid[],
  p_target_period_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.learning_periods%ROWTYPE;
  v_found int;
  v_moved int;
  v_period_ids uuid[];
  v_quota_closed_ids uuid[];
  v_period record;
  v_consumed int;
  v_close_date date;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can move attendance';
  END IF;

  IF p_attendance_ids IS NULL OR cardinality(p_attendance_ids) = 0 THEN
    RAISE EXCEPTION 'Pilih minimal satu hari untuk dipindahkan.';
  END IF;

  SELECT * INTO v_target
    FROM public.learning_periods
    WHERE id = p_target_period_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Periode tujuan tidak ditemukan.';
  END IF;

  SELECT count(*) INTO v_found
    FROM public.child_attendances
    WHERE id = ANY (p_attendance_ids);
  IF v_found <> cardinality(p_attendance_ids) THEN
    RAISE EXCEPTION 'Sebagian absen tidak ditemukan. Muat ulang halaman lalu coba lagi.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.child_attendances
     WHERE id = ANY (p_attendance_ids)
       AND (child_id <> v_target.child_id OR classroom_id <> v_target.classroom_id)
  ) THEN
    RAISE EXCEPTION 'Absen hanya bisa dipindahkan ke periode milik anak dan kelas yang sama.';
  END IF;

  -- Every affected period, locked, and — snapshotted before the move — the ones their quota had
  -- closed: only those reopen if the move drops them below it.
  SELECT array_agg(lp.id ORDER BY lp.id) INTO v_period_ids
    FROM public.learning_periods lp
   WHERE lp.id = p_target_period_id
      OR lp.id IN (SELECT learning_period_id FROM public.child_attendances
                    WHERE id = ANY (p_attendance_ids));

  PERFORM 1 FROM public.learning_periods WHERE id = ANY (v_period_ids) FOR UPDATE;

  SELECT coalesce(array_agg(lp.id), '{}') INTO v_quota_closed_ids
    FROM public.learning_periods lp
   WHERE lp.id = ANY (v_period_ids)
     AND lp.closed_at IS NOT NULL
     AND (SELECT count(*) FROM public.child_attendances ca
           WHERE ca.learning_period_id = lp.id AND ca.status <> 'sick') >= lp.guaranteed_days;

  UPDATE public.child_attendances
     SET learning_period_id = p_target_period_id
   WHERE id = ANY (p_attendance_ids)
     AND learning_period_id <> p_target_period_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  SELECT count(*) INTO v_consumed
    FROM public.child_attendances
   WHERE learning_period_id = p_target_period_id AND status <> 'sick';
  IF v_consumed > v_target.guaranteed_days THEN
    RAISE EXCEPTION 'Periode tujuan hanya menjamin % hari; setelah dipindah akan terpakai % hari.',
      v_target.guaranteed_days, v_consumed;
  END IF;

  FOR v_period IN
    SELECT lp.id, lp.guaranteed_days, lp.id = ANY (v_quota_closed_ids) AS quota_closed
      FROM public.learning_periods lp
     WHERE lp.id = ANY (v_period_ids)
  LOOP
    SELECT count(*) INTO v_consumed
      FROM public.child_attendances
     WHERE learning_period_id = v_period.id AND status <> 'sick';

    IF v_consumed >= v_period.guaranteed_days THEN
      SELECT s.attendance_date INTO v_close_date
        FROM (
          SELECT ca.attendance_date,
                 row_number() OVER (ORDER BY ca.attendance_date) AS rn
            FROM public.child_attendances ca
           WHERE ca.learning_period_id = v_period.id AND ca.status <> 'sick'
        ) s
       WHERE s.rn = v_period.guaranteed_days;

      UPDATE public.learning_periods
         SET actual_end_date = v_close_date,
             closed_at = COALESCE(closed_at, now())
       WHERE id = v_period.id;
    ELSIF v_period.quota_closed THEN
      UPDATE public.learning_periods
         SET closed_at = NULL, actual_end_date = NULL
       WHERE id = v_period.id;
    END IF;
  END LOOP;

  RETURN v_moved;
END;
$$;

COMMENT ON FUNCTION public.move_child_attendances(uuid[], uuid) IS
  'Admin-only. Re-points attendance days at another learning period of the same child and '
  'classroom, then recomputes both periods'' closure. Refuses to overfill the target. A period '
  'closed by hand stays closed; one closed by its quota reopens if the move drops it below.';

REVOKE ALL ON FUNCTION public.move_child_attendances(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_child_attendances(uuid[], uuid) TO authenticated, service_role;
