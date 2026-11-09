-- learning_periods.is_active: a real, stored Aktif / Tidak aktif flag.
--
-- The owner's definition, enforced here and nowhere else:
--
--   is_active = closed_at IS NULL AND at least one child_attendances row on the period
--
--   * Aktif (Berjalan):        started (a day is recorded on it) and not finished.
--   * Tidak aktif, not closed: Belum Mulai â€” sold, but nobody has attended yet.
--   * Tidak aktif, closed:     Selesai â€” quota used up, or an admin pressed Tandai Selesai.
--
-- Until now "active" was computed in learning_period_status as "not closed and quota left", so a
-- period nobody had attended (207 of 376 on 2026-11-09) showed Berjalan, and a fresh renewal could
-- not be told apart from the period actually running.
--
-- The flag is maintained only by triggers, so every writer â€” the RPCs and the admin client's
-- direct updates (Edit, Tandai Selesai) â€” keeps it right without knowing about it, and a direct
-- write to the column is simply recomputed.
--
-- More than one active period per (child, classroom) is deliberately allowed: this is the
-- transition from the manual process, the admin needs full access, and the app shows a red
-- warning when it happens instead of the database refusing.
--
-- Also in here:
--   * record_attendance files a teacher's new date on the active period first.
--   * Nasyitha Raihani Latulola's one Periode 3 day moves into her Periode 2 (decided 2026-11-09),
--     the only (child, classroom) that would otherwise start with two active periods.
--
-- Rollback point: backup.*_20261109 below, plus a JSON export of both tables taken before applying.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Rollback point.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS backup;
REVOKE ALL ON SCHEMA backup FROM PUBLIC, anon, authenticated;

CREATE TABLE backup.learning_periods_20261109 AS TABLE public.learning_periods;
CREATE TABLE backup.child_attendances_20261109 AS TABLE public.child_attendances;

REVOKE ALL ON ALL TABLES IN SCHEMA backup FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM backup.learning_periods_20261109) <> (SELECT count(*) FROM public.learning_periods)
     OR (SELECT count(*) FROM backup.child_attendances_20261109) <> (SELECT count(*) FROM public.child_attendances)
  THEN
    RAISE EXCEPTION 'Snapshot row counts do not match the live tables';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------

ALTER TABLE public.learning_periods
  ADD COLUMN is_active boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.learning_periods.is_active IS
  'Aktif: closed_at IS NULL and at least one attendance day is recorded on the period. Maintained '
  'by triggers (learning_periods_set_active, child_attendances_refresh_period_active); a direct '
  'write is recomputed. More than one active period per child and classroom is allowed â€” the app '
  'warns about it.';

-- ---------------------------------------------------------------------------
-- 2. Triggers.
-- ---------------------------------------------------------------------------

-- Any write to a period recomputes its flag from its own closed_at and its attendance, which is
-- what makes the column effectively read-only: Tandai Selesai, Edit, quota close and reopen all
-- land here.
CREATE FUNCTION public.learning_periods_set_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.is_active := NEW.closed_at IS NULL
    AND EXISTS (SELECT 1 FROM public.child_attendances ca WHERE ca.learning_period_id = NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_periods_set_active
  BEFORE INSERT OR UPDATE ON public.learning_periods
  FOR EACH ROW EXECUTE FUNCTION public.learning_periods_set_active();

-- A day added, removed or moved changes whether its period(s) have attendance. Touching the row
-- is enough: the BEFORE trigger above recomputes the flag. SECURITY DEFINER because a teacher
-- records attendance but cannot update learning_periods.
CREATE FUNCTION public.child_attendances_refresh_period_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE public.learning_periods SET is_active = is_active WHERE id = OLD.learning_period_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE public.learning_periods SET is_active = is_active WHERE id = NEW.learning_period_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER child_attendances_refresh_period_active
  AFTER INSERT OR DELETE OR UPDATE OF learning_period_id ON public.child_attendances
  FOR EACH ROW EXECUTE FUNCTION public.child_attendances_refresh_period_active();

REVOKE ALL ON FUNCTION public.learning_periods_set_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.child_attendances_refresh_period_active() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Backfill. The BEFORE trigger computes the value; the SET is only there to fire it.
-- ---------------------------------------------------------------------------

UPDATE public.learning_periods SET is_active = is_active;

-- ---------------------------------------------------------------------------
-- 4. learning_period_status reads the stored flag. Dropped and recreated: lp.* now carries
--    is_active, and the old computed column of the same name would collide with it.
-- ---------------------------------------------------------------------------

DROP VIEW public.learning_period_status;

CREATE VIEW public.learning_period_status
WITH (security_invoker = true) AS
SELECT
  lp.*,
  count(ca.id) FILTER (WHERE ca.status <> 'sick')      AS days_consumed,
  count(ca.id) FILTER (WHERE ca.status = 'sick')       AS days_sick,
  lp.guaranteed_days
    - count(ca.id) FILTER (WHERE ca.status <> 'sick')  AS days_remaining
FROM public.learning_periods lp
LEFT JOIN public.child_attendances ca ON ca.learning_period_id = lp.id
GROUP BY lp.id;

COMMENT ON VIEW public.learning_period_status IS
  'The whole quota computation, in one place. is_active is the stored flag from learning_periods. '
  'security_invoker so the policies on learning_periods and child_attendances apply to readers of '
  'the view â€” without it the view would run as its owner and leak every family''s periods.';

GRANT SELECT ON public.learning_period_status TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. record_attendance: a teacher's new date goes to the active period first, then (as before)
--    the lowest-numbered open one. Body otherwise identical to 20261109020000.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_attendance(
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
      ORDER BY lp.is_active DESC, lp.period_no
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

-- ---------------------------------------------------------------------------
-- 6. Nasyitha Raihani Latulola, Kelas Bimba 15.30 - 17.30: her one Periode 3 day belongs on
--    Periode 2. Moved through move_child_attendances (admin claims set for this transaction only)
--    so the quota/closure rules are the same as Pindahkan Absen.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_p2 uuid;
  v_p3 uuid;
  v_days uuid[];
  v_moved int;
BEGIN
  SELECT p2.id, p3.id INTO v_p2, v_p3
    FROM public.children c
    JOIN public.classrooms cl ON cl.label = 'Kelas Bimba Pukul 15.30 - 17.30'
    JOIN public.learning_periods p2 ON p2.child_id = c.id AND p2.classroom_id = cl.id AND p2.period_no = 2
    JOIN public.learning_periods p3 ON p3.child_id = c.id AND p3.classroom_id = cl.id AND p3.period_no = 3
   WHERE c.full_name = 'Nasyitha Raihani Latulola';
  IF v_p2 IS NULL OR v_p3 IS NULL THEN
    RAISE EXCEPTION 'Nasyitha: Periode 2/3 not found';
  END IF;

  SELECT array_agg(id) INTO v_days FROM public.child_attendances WHERE learning_period_id = v_p3;
  IF cardinality(v_days) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Nasyitha: expected exactly 1 day on Periode 3, found %', coalesce(cardinality(v_days), 0);
  END IF;

  PERFORM set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
  v_moved := public.move_child_attendances(v_days, v_p2);
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_moved <> 1 THEN
    RAISE EXCEPTION 'Nasyitha: expected 1 day moved, moved %', v_moved;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Nothing lost, every flag right, the one known conflict gone.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_wrong int;
  v_conflicts text;
BEGIN
  IF (SELECT count(*) FROM backup.learning_periods_20261109) <> (SELECT count(*) FROM public.learning_periods)
     OR (SELECT count(*) FROM backup.child_attendances_20261109) <> (SELECT count(*) FROM public.child_attendances)
  THEN
    RAISE EXCEPTION 'Row counts changed during the migration';
  END IF;

  SELECT count(*) INTO v_wrong
    FROM public.learning_periods lp
   WHERE lp.is_active IS DISTINCT FROM (
           lp.closed_at IS NULL
           AND EXISTS (SELECT 1 FROM public.child_attendances ca WHERE ca.learning_period_id = lp.id));
  IF v_wrong > 0 THEN
    RAISE EXCEPTION '% periods have the wrong is_active', v_wrong;
  END IF;

  SELECT string_agg(child_id || '/' || classroom_id, ', ') INTO v_conflicts
    FROM (SELECT child_id, classroom_id FROM public.learning_periods
           WHERE is_active GROUP BY 1, 2 HAVING count(*) > 1) x;
  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Still more than one active period for: %', v_conflicts;
  END IF;
END;
$$;

COMMIT;
