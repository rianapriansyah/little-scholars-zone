-- Tambah Absen files the day on the learning period it was added from.
--
-- record_attendance() picks the open period with the lowest period_no for a new date. That is
-- right for a teacher filling the daily roster, but wrong when an admin adds a day from a specific
-- period's card: a stale older period that was never closed swallows the day, and it shows up
-- under the wrong card (Adzkhan, 2026-11-06 — landed in Periode 1 instead of Periode 2).
--
-- So record_attendance gains p_learning_period_id, DEFAULT NULL:
--   * NULL (every teacher call, unchanged): exactly the old behaviour.
--   * Set: admin only. The period must belong to this child and classroom. The day goes on that
--     period whether the period is open or closed by hand, but it may not overfill the quota.
--     If the date already sits on another period, it is moved first via move_child_attendances,
--     which also recomputes the old period's closure.
--
-- Dropped and recreated rather than replaced: adding a parameter with CREATE OR REPLACE makes a
-- second overload, and PostgREST refuses to choose between two candidates that both accept the
-- old five named arguments. The body is otherwise the live definition from
-- 20261108030000_daily_report_belongs_to_attendance.sql.

-- One transaction, so teachers never see the function missing between the drop and the create.
BEGIN;

DROP FUNCTION IF EXISTS public.record_attendance(uuid, uuid, date, text, text);

CREATE FUNCTION public.record_attendance(
  p_child_id uuid,
  p_classroom_id uuid,
  p_date date,
  p_status text,
  p_note text DEFAULT NULL,
  p_learning_period_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id uuid;
  v_existing_id uuid;
  v_attendance_id uuid;
  v_guaranteed smallint;
  v_consumed int;
BEGIN
  IF NOT public.can_record_attendance(p_classroom_id, p_date) THEN
    RAISE EXCEPTION 'Not authorised to record attendance for this classroom';
  END IF;

  IF p_status NOT IN ('present', 'absent', 'sick') THEN
    RAISE EXCEPTION 'Unknown attendance status: %', p_status;
  END IF;

  IF p_learning_period_id IS NOT NULL THEN
    IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only an admin can choose the learning period for a day';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.learning_periods lp
       WHERE lp.id = p_learning_period_id
         AND lp.child_id = p_child_id
         AND lp.classroom_id = p_classroom_id
    ) THEN
      RAISE EXCEPTION 'Periode belajar ini bukan milik anak dan kelas tersebut.';
    END IF;
  END IF;

  -- children_classrooms enrols into a (classroom, teacher) pair, so the classroom only comes
  -- out of the join through classroom_teachers.
  IF NOT EXISTS (
    SELECT 1
    FROM public.children_classrooms cc
    JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
    WHERE cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = p_classroom_id
  ) THEN
    RAISE EXCEPTION 'Child is not actively enrolled in this classroom';
  END IF;

  -- A day with a daily report stays 'present': the report describes a day the child was there.
  -- children_daily_reports_attendance_fkey refuses the change at commit regardless; this says so
  -- in words. Re-saving 'present' (e.g. to edit the note) is still fine.
  IF p_status <> 'present' AND EXISTS (
    SELECT 1
      FROM public.children_daily_reports r
      JOIN public.child_attendances ca ON ca.id = r.child_attendance_id
     WHERE ca.child_id = p_child_id
       AND ca.classroom_id = p_classroom_id
       AND ca.attendance_date = p_date
  ) THEN
    RAISE EXCEPTION 'Absensi ini sudah punya laporan harian. Minta admin menghapus laporan dulu.';
  END IF;

  SELECT ca.id, ca.learning_period_id INTO v_existing_id, v_period_id
    FROM public.child_attendances ca
    WHERE ca.child_id = p_child_id
      AND ca.classroom_id = p_classroom_id
      AND ca.attendance_date = p_date;

  IF p_learning_period_id IS NOT NULL THEN
    -- The admin named the period. A date already filed elsewhere moves over first, so the old
    -- period's quota and closure are put right by the same code Pindahkan Absen uses.
    IF v_existing_id IS NOT NULL AND v_period_id <> p_learning_period_id THEN
      PERFORM public.move_child_attendances(ARRAY[v_existing_id], p_learning_period_id);
    END IF;
    v_period_id := p_learning_period_id;
  ELSIF v_period_id IS NULL THEN
    -- A correction stays in the period it was originally filed against, even once that period
    -- has closed. Only a genuinely new date needs an open period to draw from.
    SELECT lp.id INTO v_period_id
      FROM public.learning_periods lp
      WHERE lp.child_id = p_child_id
        AND lp.classroom_id = p_classroom_id
        AND lp.closed_at IS NULL
      ORDER BY lp.period_no
      LIMIT 1;

    IF v_period_id IS NULL THEN
      RAISE EXCEPTION 'No open learning period for this child in this classroom; create one first';
    END IF;
  END IF;

  INSERT INTO public.child_attendances (
    learning_period_id, child_id, classroom_id, attendance_date, status, note, recorded_by
  )
  VALUES (v_period_id, p_child_id, p_classroom_id, p_date, p_status, p_note, auth.uid())
  ON CONFLICT ON CONSTRAINT child_attendances_child_classroom_date_key
  DO UPDATE SET
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    recorded_by = EXCLUDED.recorded_by,
    recorded_at = now()
  RETURNING id INTO v_attendance_id;

  SELECT lp.guaranteed_days INTO v_guaranteed
    FROM public.learning_periods lp WHERE lp.id = v_period_id;

  SELECT count(*) INTO v_consumed
    FROM public.child_attendances ca
    WHERE ca.learning_period_id = v_period_id
      AND ca.status <> 'sick';

  -- Chosen periods only: the automatic pick only ever draws from an open one, which closes the
  -- moment it is full, and a teacher's correction keeps its old (unchecked) behaviour.
  IF p_learning_period_id IS NOT NULL AND v_consumed > v_guaranteed THEN
    RAISE EXCEPTION 'Periode ini sudah penuh (% hari). Pilih periode lain.', v_guaranteed;
  END IF;

  -- `closed_at IS NULL` keeps this idempotent: re-submitting the closing date is a no-op
  -- rather than bumping the timestamp.
  IF v_consumed >= v_guaranteed THEN
    UPDATE public.learning_periods
      SET closed_at = now(), actual_end_date = p_date
      WHERE id = v_period_id AND closed_at IS NULL;
  END IF;

  RETURN v_attendance_id;
END;
$$;

COMMENT ON FUNCTION public.record_attendance(uuid, uuid, date, text, text, uuid) IS
  'Records or corrects one child''s attendance for a date. Without p_learning_period_id a new '
  'date goes to the lowest-numbered open period and a correction stays where it was filed. With '
  'it (admin only — Tambah Absen from a period''s card) the day is filed on that period, moving '
  'it there if it was filed elsewhere, and refused if it would overfill the quota.';

REVOKE ALL ON FUNCTION public.record_attendance(uuid, uuid, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_attendance(uuid, uuid, date, text, text, uuid) TO authenticated, service_role;

COMMIT;
