-- A daily report now belongs to exactly one absensi row, and the database keeps the two in step.
--
-- Until now a report only copied the values that should identify its absensi day — child_id,
-- report_date, and the class reached through classroom_teacher_id — and every reader re-matched
-- them. Nothing in the schema tied the two rows together, so when 20260825010000 let a period
-- delete cascade through its absensi, 18 reports were simply left behind (see 20261108020000).
-- And absensi could still be switched from present to absent/sick after its report was written,
-- leaving a report about a day the child "wasn't there".
--
-- Now:
--
--   children_daily_reports.child_attendance_id   the absensi row this report is about
--   children_daily_reports.classroom_id          that row's class (needed for the composite FKs)
--   children_daily_reports.attendance_status     always 'present' — part of the FK, see below
--
--   (child_attendance_id, child_id, classroom_id, report_date, attendance_status)
--     → child_attendances (id, child_id, classroom_id, attendance_date, status)
--
-- Because the status is part of the key and the report's side is pinned to 'present', the FK
-- itself refuses any UPDATE that moves a reported absensi row off 'present', and any DELETE or
-- re-date of it. The copied columns stay (RLS and the client read child_id/report_date) but can no
-- longer disagree with the row they copy. UNIQUE (child_attendance_id) makes it one report per day.
--
-- (classroom_teacher_id, classroom_id) → classroom_teachers (id, classroom_id) pins the teaching
-- group to the same class as the absensi.
--
-- Both FKs to child_attendances are DEFERRABLE INITIALLY DEFERRED, checked at commit, so deleting a
-- family — which removes reports and absensi through two separate cascades from children — passes
-- whatever order those cascades run in.
--
-- The 18 orphaned reports (child 87b8984a…, Kelas Bimba 08.00–10.00) have no absensi to point at:
-- it was deleted and the free plan has no backup. They stay exactly as they are — readable, still
-- refused for edits by the trigger — until the owner decides with the admin what they should become.
-- The NOT VALID check below makes every other report, and every future write, carry the link; it
-- is validated once those 18 are resolved.
--
-- Writers are unchanged: enforce_daily_report_child_present() already looked up the present absensi
-- row on every insert and update, and now records what it found. record_attendance refuses the
-- status change up front with a sentence the teacher can act on, and admins get
-- delete_daily_report() to clear a report when a day genuinely needs correcting.

CREATE TEMP TABLE _counts_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.child_attendances) AS attendances,
  (SELECT count(*) FROM public.children_daily_reports) AS reports,
  (SELECT count(*) FROM public.learning_periods) AS periods,
  (SELECT count(*) FROM public.payment_periods) AS payments;

-- ---------------------------------------------------------------------------
-- 1. Keys the new FKs point at.
-- ---------------------------------------------------------------------------

ALTER TABLE public.child_attendances
  ADD CONSTRAINT child_attendances_report_target_key
  UNIQUE (id, child_id, classroom_id, attendance_date, status);

ALTER TABLE public.classroom_teachers
  ADD CONSTRAINT classroom_teachers_id_classroom_key
  UNIQUE (id, classroom_id);

-- ---------------------------------------------------------------------------
-- 2. The columns.
-- ---------------------------------------------------------------------------

ALTER TABLE public.children_daily_reports
  ADD COLUMN child_attendance_id uuid,
  ADD COLUMN classroom_id uuid,
  ADD COLUMN attendance_status text NOT NULL DEFAULT 'present'
    CONSTRAINT children_daily_reports_attendance_status_check CHECK (attendance_status = 'present');

COMMENT ON COLUMN public.children_daily_reports.child_attendance_id IS
  'The absensi row this report describes. Filled in by enforce_daily_report_child_present() on every '
  'write; never set it by hand. NULL only on the 18 legacy reports whose absensi was deleted before '
  'this link existed (see 20261108030000).';
COMMENT ON COLUMN public.children_daily_reports.classroom_id IS
  'Copy of the absensi row''s classroom_id, kept so the composite FKs can prove the report, its '
  'absensi and its teaching group all name the same class. Do not normalise away.';
COMMENT ON COLUMN public.children_daily_reports.attendance_status IS
  'Always ''present''. Exists only to be part of children_daily_reports_attendance_fkey, which is '
  'what stops a reported absensi day from being switched to absent or sick.';

-- ---------------------------------------------------------------------------
-- 3. The trigger records the absensi row it already looked up.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_daily_report_child_present()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_classroom_id uuid;
BEGIN
  -- At most one row: child_attendances is unique on (child, classroom, date), and a group belongs
  -- to exactly one classroom.
  SELECT ca.id, ca.classroom_id
    INTO v_attendance_id, v_classroom_id
    FROM public.child_attendances ca
    JOIN public.classroom_teachers ct ON ct.classroom_id = ca.classroom_id
   WHERE ct.id = NEW.classroom_teacher_id
     AND ca.child_id = NEW.child_id
     AND ca.attendance_date = NEW.report_date
     AND ca.status = 'present';

  IF v_attendance_id IS NULL THEN
    RAISE EXCEPTION 'Laporan harian hanya bisa diisi untuk siswa yang tercatat hadir di kelas ini pada %', NEW.report_date;
  END IF;

  NEW.child_attendance_id := v_attendance_id;
  NEW.classroom_id := v_classroom_id;
  NEW.attendance_status := 'present';

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_daily_report_child_present() IS
  'Runs before every insert and update of children_daily_reports. Refuses the write unless the child '
  'has a ''present'' absensi row for the report''s class and date, and links the report to that row '
  '(child_attendance_id, classroom_id). The single place the link is set.';

-- ---------------------------------------------------------------------------
-- 4. Backfill every report whose absensi still exists. The trigger fires on this UPDATE and
--    re-derives the same values, which doubles as a check that each of these days is present.
-- ---------------------------------------------------------------------------

UPDATE public.children_daily_reports r
   SET child_attendance_id = a.id,
       classroom_id = a.classroom_id
  FROM public.classroom_teachers ct
  JOIN public.child_attendances a ON a.classroom_id = ct.classroom_id
 WHERE ct.id = r.classroom_teacher_id
   AND a.child_id = r.child_id
   AND a.attendance_date = r.report_date;

-- ---------------------------------------------------------------------------
-- 5. Constraints. ADD CONSTRAINT validates the existing rows immediately, deferrable or not.
-- ---------------------------------------------------------------------------

ALTER TABLE public.children_daily_reports
  ADD CONSTRAINT children_daily_reports_attendance_fkey
  FOREIGN KEY (child_attendance_id, child_id, classroom_id, report_date, attendance_status)
  REFERENCES public.child_attendances (id, child_id, classroom_id, attendance_date, status)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT children_daily_reports_attendance_fkey ON public.children_daily_reports IS
  'A report and its absensi day cannot disagree: the absensi row cannot be deleted, re-dated, moved '
  'to another child or class, or switched off ''present'' while a report points at it. Deferred so '
  'family deletion (two cascades from children) passes at commit. Never make this CASCADE.';

ALTER TABLE public.children_daily_reports
  ADD CONSTRAINT children_daily_reports_child_attendance_id_key UNIQUE (child_attendance_id);

ALTER TABLE public.children_daily_reports
  ADD CONSTRAINT children_daily_reports_group_classroom_fkey
  FOREIGN KEY (classroom_teacher_id, classroom_id)
  REFERENCES public.classroom_teachers (id, classroom_id);

-- Every new or edited report must carry the link. NOT VALID leaves only the 18 legacy rows, which
-- the trigger already refuses to edit; VALIDATE CONSTRAINT once they are resolved.
ALTER TABLE public.children_daily_reports
  ADD CONSTRAINT children_daily_reports_linked_check
  CHECK (child_attendance_id IS NOT NULL AND classroom_id IS NOT NULL)
  NOT VALID;

-- ---------------------------------------------------------------------------
-- 6. record_attendance: say why a reported day can't change status, before the FK does.
--    Recreated from the live definition; only the report check is new.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_attendance(
  p_child_id uuid,
  p_classroom_id uuid,
  p_date date,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id uuid;
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

  -- A correction stays in the period it was originally filed against, even once that period
  -- has closed. Only a genuinely new date needs an open period to draw from.
  SELECT ca.learning_period_id INTO v_period_id
    FROM public.child_attendances ca
    WHERE ca.child_id = p_child_id
      AND ca.classroom_id = p_classroom_id
      AND ca.attendance_date = p_date;

  IF v_period_id IS NULL THEN
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
-- 7. delete_child_attendance: look the report up by its link. Recreated from the live
--    definition; only the report check changes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_child_attendance(p_attendance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id uuid;
  v_classroom_id uuid;
  v_date date;
  v_period_id uuid;
  v_guaranteed smallint;
  v_consumed int;
  v_close_date date;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can delete attendance';
  END IF;

  SELECT ca.child_id, ca.classroom_id, ca.attendance_date, ca.learning_period_id
    INTO v_child_id, v_classroom_id, v_date, v_period_id
    FROM public.child_attendances ca
    WHERE ca.id = p_attendance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance row not found';
  END IF;

  -- children_daily_reports_attendance_fkey refuses this at commit regardless; this says so first.
  IF EXISTS (
    SELECT 1 FROM public.children_daily_reports r WHERE r.child_attendance_id = p_attendance_id
  ) THEN
    RAISE EXCEPTION 'Attendance has a daily report filed against it';
  END IF;

  DELETE FROM public.child_attendances WHERE id = p_attendance_id;

  SELECT lp.guaranteed_days INTO v_guaranteed
    FROM public.learning_periods lp WHERE lp.id = v_period_id;

  SELECT count(*) INTO v_consumed
    FROM public.child_attendances ca
    WHERE ca.learning_period_id = v_period_id AND ca.status <> 'sick';

  IF v_consumed >= v_guaranteed THEN
    SELECT s.attendance_date INTO v_close_date
      FROM (
        SELECT ca.attendance_date,
               row_number() OVER (ORDER BY ca.attendance_date) AS rn
          FROM public.child_attendances ca
         WHERE ca.learning_period_id = v_period_id AND ca.status <> 'sick'
      ) s
     WHERE s.rn = v_guaranteed;

    UPDATE public.learning_periods
       SET actual_end_date = v_close_date,
           closed_at = COALESCE(closed_at, now())
     WHERE id = v_period_id;
  ELSE
    UPDATE public.learning_periods
       SET closed_at = NULL, actual_end_date = NULL
     WHERE id = v_period_id;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. daily_report_for_attendance: follow the link instead of re-matching the copied values.
--    Recreated from the live definition (which already reads public.employees); only the join to
--    the absensi row and the WHERE change. Same signature, same access clause.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.daily_report_for_attendance(
  p_child_id uuid,
  p_classroom_id uuid,
  p_report_date date
)
RETURNS TABLE (
  id uuid,
  submitted_at timestamptz,
  mood_arrival text,
  mood_studying text,
  mood_departure text,
  teacher_note text,
  teacher_full_name text,
  teacher_call_name text,
  author_is_admin boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.submitted_at,
    r.mood_arrival,
    r.mood_studying,
    r.mood_departure,
    r.teacher_note,
    author.full_name,
    author.call_name,
    author.is_admin
  FROM public.child_attendances a
  JOIN public.children_daily_reports r ON r.child_attendance_id = a.id
  JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
  -- One row, chosen by priority, so the name and the call name can never come from different
  -- people: independent COALESCEs over separate joins would happily pair one teacher's full name
  -- with another's call name whenever the first has none.
  LEFT JOIN LATERAL (
    SELECT candidate.full_name, candidate.call_name, candidate.is_admin
    FROM (
      SELECT 1 AS prio, ts.full_name, ts.call_name, false AS is_admin
        FROM public.employees ts WHERE ts.auth_user_id = r.submitted_by
      UNION ALL
      SELECT 2, NULL::text, NULL::text, true
        FROM auth.users su
        WHERE su.id = r.submitted_by
          AND (su.raw_app_meta_data ->> 'role') = 'admin'
      UNION ALL
      SELECT 3, tc.full_name, tc.call_name, false
        FROM public.employees tc WHERE tc.auth_user_id = r.created_by
      UNION ALL
      SELECT 4, NULL::text, NULL::text, true
        FROM auth.users cu
        WHERE cu.id = r.created_by
          AND (cu.raw_app_meta_data ->> 'role') = 'admin'
      UNION ALL
      -- Last resort: whoever the group belongs to. Covers reports written before submitted_by
      -- existed, and a teacher account since deleted.
      SELECT 5, ta.full_name, ta.call_name, false
        FROM public.employees ta WHERE ta.id = ct.teacher_id
    ) candidate
    ORDER BY candidate.prio
    LIMIT 1
  ) author ON true
  WHERE a.child_id = p_child_id
    AND a.classroom_id = p_classroom_id
    AND a.attendance_date = p_report_date
    AND (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      OR r.classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid()))
      -- The substitute reads back the day she covered, and only that day.
      OR public.is_substitute_for(r.classroom_teacher_id, r.report_date)
      OR (
        r.submitted_at IS NOT NULL
        AND r.child_id IN (SELECT public.family_children_ids(auth.uid()))
      )
    )
  -- children_daily_reports_child_attendance_id_key makes this one row at most.
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 9. delete_daily_report: the admin's way to clear a report so its day can be corrected.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.delete_daily_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- IS DISTINCT FROM, not <>: with no role claim the comparison is NULL, which an IF treats as
  -- false and would wave the caller through.
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Hanya admin yang dapat menghapus laporan harian';
  END IF;

  -- daily_report_items cascades from the report on its own.
  DELETE FROM public.children_daily_reports WHERE id = p_report_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laporan harian tidak ditemukan';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.delete_daily_report(uuid) IS
  'Admin only. Deletes one daily report (and its daily_report_items), sent or not, so that its absensi '
  'day can be corrected — a reported day cannot leave ''present'' while the report exists.';

REVOKE EXECUTE ON FUNCTION public.delete_daily_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_daily_report(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Nothing lost, everything that can link did.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  b record;
  v_linked int;
  v_unlinked int;
  v_unlinked_with_absensi int;
BEGIN
  SELECT * INTO b FROM _counts_before;
  IF (SELECT count(*) FROM public.child_attendances) <> b.attendances
     OR (SELECT count(*) FROM public.children_daily_reports) <> b.reports
     OR (SELECT count(*) FROM public.learning_periods) <> b.periods
     OR (SELECT count(*) FROM public.payment_periods) <> b.payments
  THEN
    RAISE EXCEPTION 'Row counts changed during the migration';
  END IF;

  SELECT count(*) FILTER (WHERE child_attendance_id IS NOT NULL),
         count(*) FILTER (WHERE child_attendance_id IS NULL)
    INTO v_linked, v_unlinked
    FROM public.children_daily_reports;

  -- Every unlinked report must be one with no absensi left to link to — never a report the
  -- backfill simply missed.
  SELECT count(*) INTO v_unlinked_with_absensi
    FROM public.children_daily_reports r
    JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
    JOIN public.child_attendances a
      ON a.child_id = r.child_id AND a.classroom_id = ct.classroom_id AND a.attendance_date = r.report_date
   WHERE r.child_attendance_id IS NULL;

  IF v_unlinked_with_absensi > 0 THEN
    RAISE EXCEPTION '% reports have absensi but were not linked', v_unlinked_with_absensi;
  END IF;

  IF v_unlinked > 18 THEN
    RAISE EXCEPTION 'Expected at most the 18 known orphaned reports to stay unlinked, found %', v_unlinked;
  END IF;

  RAISE NOTICE 'Linked % reports; % legacy reports left unlinked', v_linked, v_unlinked;
END;
$$;
