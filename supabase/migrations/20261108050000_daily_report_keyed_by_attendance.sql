-- Step 2 of 2: a daily report is now identified by its absensi row and nothing else.
--
-- Requires step 1 (20261108040000_daily_report_read_rpcs.sql) AND the client that reads reports
-- through its RPCs to be deployed first: the previous client filters children_daily_reports by
-- report_date and classroom_teacher_id, which this drops.
--
-- Since 20261108030000 every report points at one absensi row (child_attendance_id), and the FK
-- holds the report's copies of that row's child, class, date and status equal to it. The owner's
-- call: the absensi row is the only source of truth, so the copies that only repeat it — or that
-- were never used — go:
--
--   report_date           = the absensi row's attendance_date. Read through the link instead.
--   classroom_teacher_id  = the teaching group. Derived from the child's placement in that class on
--                           the absensi date (daily_report_group_id below). On a handover day, when
--                           switch_classroom leaves the child in two groups for one day, the newer
--                           placement wins — which is exactly who wrote every one of the 12
--                           handover-day reports on file. Checked before this was written: the
--                           derived group equals the stored one for all 1,291 linked reports.
--   session_id            never filled; it anticipated a class-session table, which the absensi
--                         link now stands in for.
--   mood_note,
--   mood_note_parent      never filled since 20261001020000; nothing reads them.
--
-- child_id stays: the parent's RLS reads it on every row. classroom_id and attendance_status stay as
-- the FK's copies of the absensi row (classroom_id now only that — the group FK it also served goes
-- with classroom_teacher_id).
--
-- The 18 reports whose absensi was erased before the link existed (child 87b8984a…, Kelas Bimba
-- 08.00–10.00, 1 Oct – 4 Nov) are deleted first: without report_date and classroom_teacher_id
-- nothing would say which day or class they were about, and the owner has given them up. Their
-- full content is kept outside the database (orphan-reports-18.csv) and inside it in
-- backup.children_daily_reports_20261108; a second snapshot is taken below so the dropped columns
-- of every report survive too.
--
-- What callers see does not change:
--   * save_daily_report_mood / _teacher_note / _items and submit_daily_report keep their
--     signatures. The save RPCs still take (child, group, date) — that is how a teacher points at a
--     slot — but now resolve the absensi row themselves and store only its id.
--   * Two read RPCs replace the client's direct table reads by group and date:
--     daily_report_summaries (the roster badges) and daily_report_for_slot (one sheet).
--   * Teacher, substitute and parent access are exactly as before, re-expressed through the derived
--     group and the absensi date.

CREATE TEMP TABLE _counts_before ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.child_attendances) AS attendances,
  (SELECT count(*) FROM public.children_daily_reports) AS reports,
  (SELECT count(*) FROM public.children_daily_reports WHERE child_attendance_id IS NULL) AS orphans,
  (SELECT count(*) FROM public.daily_report_items) AS items,
  (SELECT count(*) FROM public.learning_periods) AS periods;

-- ---------------------------------------------------------------------------
-- 0. Snapshot every report as it is, dropped columns included.
-- ---------------------------------------------------------------------------

CREATE TABLE backup.children_daily_reports_20261108_pre_drop AS TABLE public.children_daily_reports;
REVOKE ALL ON backup.children_daily_reports_20261108_pre_drop FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Give up the 18 orphans.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_orphans int;
  v_other_children int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE child_id <> '87b8984a-9b89-4998-96f3-d3cb452aebdb')
    INTO v_orphans, v_other_children
    FROM public.children_daily_reports
   WHERE child_attendance_id IS NULL;

  -- Only the known 18 of the one known child, never a report something else has unlinked since.
  IF v_orphans <> 18 OR v_other_children <> 0 THEN
    RAISE EXCEPTION 'Expected exactly the 18 known orphans of child 87b8984a…, found % (% of other children)',
      v_orphans, v_other_children;
  END IF;
END;
$$;

-- daily_report_items cascades from the report (none of these have any).
DELETE FROM public.children_daily_reports WHERE child_attendance_id IS NULL;

-- Every report is linked now, so the link is simply required.
ALTER TABLE public.children_daily_reports DROP CONSTRAINT children_daily_reports_linked_check;
ALTER TABLE public.children_daily_reports
  ALTER COLUMN child_attendance_id SET NOT NULL,
  ALTER COLUMN classroom_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The save RPCs' slot resolver. daily_report_group_id and daily_report_attendance_date come
--    from step 1 (20261108040000_daily_report_read_rpcs.sql).
-- ---------------------------------------------------------------------------

-- The absensi row a teacher's (child, group, date) slot points at, for the save RPCs. Refuses a day
-- the child was not present, and a group that was not the child's group that day.
CREATE FUNCTION public.daily_report_slot_attendance_id(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
BEGIN
  SELECT a.id INTO v_attendance_id
    FROM public.child_attendances a
    JOIN public.classroom_teachers ct ON ct.classroom_id = a.classroom_id
   WHERE ct.id = p_classroom_teacher_id
     AND a.child_id = p_child_id
     AND a.attendance_date = p_report_date
     AND a.status = 'present';

  IF v_attendance_id IS NULL THEN
    RAISE EXCEPTION 'Laporan harian hanya bisa diisi untuk siswa yang tercatat hadir di kelas ini pada %', p_report_date;
  END IF;

  -- Only reachable on a handover day from the group the child is leaving.
  IF public.daily_report_group_id(v_attendance_id) IS DISTINCT FROM p_classroom_teacher_id THEN
    RAISE EXCEPTION 'Pada % siswa ini sudah pindah ke kelompok lain, jadi laporannya diisi oleh kelompok tersebut', p_report_date;
  END IF;

  RETURN v_attendance_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.daily_report_slot_attendance_id(uuid, uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS: drop every policy that reads the columns going away, recreate them on the derived values.
-- ---------------------------------------------------------------------------

DROP POLICY teacher_select_own_children_daily_reports ON public.children_daily_reports;
DROP POLICY teacher_insert_own_children_daily_reports ON public.children_daily_reports;
DROP POLICY teacher_update_own_children_daily_reports ON public.children_daily_reports;
DROP POLICY teacher_select_substituted_daily_reports ON public.children_daily_reports;

CREATE POLICY teacher_select_own_children_daily_reports ON public.children_daily_reports FOR SELECT
  USING (public.daily_report_group_id(child_attendance_id) IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

CREATE POLICY teacher_insert_own_children_daily_reports ON public.children_daily_reports FOR INSERT
  WITH CHECK (public.daily_report_group_id(child_attendance_id) IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

CREATE POLICY teacher_update_own_children_daily_reports ON public.children_daily_reports FOR UPDATE
  USING (public.daily_report_group_id(child_attendance_id) IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())))
  WITH CHECK (public.daily_report_group_id(child_attendance_id) IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

-- Read only, and only the covered day: a substitute writes through the RPCs, never the table.
CREATE POLICY teacher_select_substituted_daily_reports ON public.children_daily_reports FOR SELECT
  USING (public.is_substitute_for(
    public.daily_report_group_id(child_attendance_id),
    public.daily_report_attendance_date(child_attendance_id)
  ));

-- daily_report_items' teacher policies go through this helper.
CREATE OR REPLACE FUNCTION public.teacher_daily_report_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dr.id
  FROM public.children_daily_reports dr
  JOIN public.classroom_teachers ct ON ct.id = public.daily_report_group_id(dr.child_attendance_id)
  JOIN public.employees t ON t.id = ct.teacher_id
  WHERE t.auth_user_id = p_auth_uid;
$$;

-- ---------------------------------------------------------------------------
-- 4. Constraints: the absensi FK loses the date; the group FK and the group/date keys go.
-- ---------------------------------------------------------------------------

ALTER TABLE public.children_daily_reports DROP CONSTRAINT children_daily_reports_attendance_fkey;
ALTER TABLE public.children_daily_reports DROP CONSTRAINT children_daily_reports_group_classroom_fkey;
ALTER TABLE public.children_daily_reports DROP CONSTRAINT children_daily_reports_child_class_date_key;
DROP INDEX public.children_daily_reports_classroom_teacher_date_idx;

-- The FK target without the date. classroom_teachers_id_classroom_key stays: Option C's placement
-- FKs are planned on it.
ALTER TABLE public.child_attendances DROP CONSTRAINT child_attendances_report_target_key;
ALTER TABLE public.child_attendances
  ADD CONSTRAINT child_attendances_report_target_key UNIQUE (id, child_id, classroom_id, status);

ALTER TABLE public.children_daily_reports
  ADD CONSTRAINT children_daily_reports_attendance_fkey
  FOREIGN KEY (child_attendance_id, child_id, classroom_id, attendance_status)
  REFERENCES public.child_attendances (id, child_id, classroom_id, status)
  ON DELETE NO ACTION
  ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT children_daily_reports_attendance_fkey ON public.children_daily_reports IS
  'A report and its absensi day cannot disagree: the absensi row cannot be deleted, moved to another '
  'child or class, or switched off ''present'' while a report points at it. Deferred so family '
  'deletion (two cascades from children) passes at commit. Never make this CASCADE.';

-- ---------------------------------------------------------------------------
-- 5. The trigger: the link is now an input, not something it looks up by date.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_daily_report_child_present()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id uuid;
  v_classroom_id uuid;
  v_status text;
  v_date date;
BEGIN
  IF NEW.child_attendance_id IS NULL THEN
    RAISE EXCEPTION 'Laporan harian harus terhubung ke satu absensi';
  END IF;

  SELECT child_id, classroom_id, status, attendance_date
    INTO v_child_id, v_classroom_id, v_status, v_date
    FROM public.child_attendances
   WHERE id = NEW.child_attendance_id;

  IF NOT FOUND OR v_status <> 'present' THEN
    RAISE EXCEPTION 'Laporan harian hanya bisa diisi untuk siswa yang tercatat hadir di kelas ini pada %', v_date;
  END IF;

  -- The copies the FK checks are always taken from the absensi row, never from the caller.
  NEW.child_id := v_child_id;
  NEW.classroom_id := v_classroom_id;
  NEW.attendance_status := 'present';

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_daily_report_child_present() IS
  'Runs before every insert and update of children_daily_reports. Requires child_attendance_id, '
  'refuses an absensi row that is not ''present'', and copies the row''s child_id and classroom_id '
  'onto the report so the FK''s copies always come from the absensi row.';

-- ---------------------------------------------------------------------------
-- 6. Writers. Same signatures; each resolves its slot to an absensi row and stores only that.
--    Authorisation, validation, the enrolment check and the submitted lock are unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_daily_report_mood(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_mood_arrival text DEFAULT NULL,
  p_mood_studying text DEFAULT NULL,
  p_mood_departure text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id, p_report_date) THEN
    RAISE EXCEPTION 'Not authorised to write reports for this class';
  END IF;

  IF p_mood_arrival IS NOT NULL AND p_mood_arrival NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_arrival: %', p_mood_arrival;
  END IF;
  IF p_mood_studying IS NOT NULL AND p_mood_studying NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_studying: %', p_mood_studying;
  END IF;
  IF p_mood_departure IS NOT NULL AND p_mood_departure NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_departure: %', p_mood_departure;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_classrooms cc
    WHERE cc.child_id = p_child_id
      AND cc.classroom_teacher_id = p_classroom_teacher_id
      AND cc.started_at <= p_report_date
      AND (cc.ended_at IS NULL OR cc.ended_at >= p_report_date)
  ) THEN
    RAISE EXCEPTION 'Child was not enrolled in this class on %', p_report_date;
  END IF;

  v_attendance_id := public.daily_report_slot_attendance_id(p_child_id, p_classroom_teacher_id, p_report_date);

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_attendance_id = v_attendance_id;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  -- The three moods are one unit (one Simpan button saves all three), so NULL here does mean
  -- "cleared" — but only for the moods. teacher_note is not in this statement at all.
  INSERT INTO public.children_daily_reports (
    child_id, child_attendance_id, created_by, mood_arrival, mood_studying, mood_departure
  )
  VALUES (
    p_child_id, v_attendance_id, auth.uid(), p_mood_arrival, p_mood_studying, p_mood_departure
  )
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_attendance_id_key
  DO UPDATE SET
    mood_arrival = EXCLUDED.mood_arrival,
    mood_studying = EXCLUDED.mood_studying,
    mood_departure = EXCLUDED.mood_departure
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_daily_report_teacher_note(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_teacher_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id, p_report_date) THEN
    RAISE EXCEPTION 'Not authorised to write reports for this class';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_classrooms cc
    WHERE cc.child_id = p_child_id
      AND cc.classroom_teacher_id = p_classroom_teacher_id
      AND cc.started_at <= p_report_date
      AND (cc.ended_at IS NULL OR cc.ended_at >= p_report_date)
  ) THEN
    RAISE EXCEPTION 'Child was not enrolled in this class on %', p_report_date;
  END IF;

  v_attendance_id := public.daily_report_slot_attendance_id(p_child_id, p_classroom_teacher_id, p_report_date);

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_attendance_id = v_attendance_id;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  -- A blank note is stored as NULL rather than '', so "has a note" is a plain IS NOT NULL.
  INSERT INTO public.children_daily_reports (child_id, child_attendance_id, created_by, teacher_note)
  VALUES (p_child_id, v_attendance_id, auth.uid(), NULLIF(btrim(p_teacher_note), ''))
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_attendance_id_key
  DO UPDATE SET teacher_note = EXCLUDED.teacher_note
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_daily_report_items(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_entries jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id, p_report_date) THEN
    RAISE EXCEPTION 'Not authorised to write reports for this class';
  END IF;

  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'p_entries must be a JSON array';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_classrooms cc
    WHERE cc.child_id = p_child_id
      AND cc.classroom_teacher_id = p_classroom_teacher_id
      AND cc.started_at <= p_report_date
      AND (cc.ended_at IS NULL OR cc.ended_at >= p_report_date)
  ) THEN
    RAISE EXCEPTION 'Child was not enrolled in this class on %', p_report_date;
  END IF;

  -- ON CONFLICT below can only merge one row per (report_id, curriculum_item_id); a payload
  -- listing the same materi twice is a client bug, not something to silently pick a winner for.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_entries) e
    GROUP BY e ->> 'curriculum_item_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'p_entries contains duplicate curriculum_item_id values';
  END IF;

  v_attendance_id := public.daily_report_slot_attendance_id(p_child_id, p_classroom_teacher_id, p_report_date);

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_attendance_id = v_attendance_id;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  -- DO UPDATE rather than DO NOTHING so RETURNING yields the existing row's id on conflict.
  INSERT INTO public.children_daily_reports (child_id, child_attendance_id, created_by)
  VALUES (p_child_id, v_attendance_id, auth.uid())
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_attendance_id_key
  DO UPDATE SET child_attendance_id = EXCLUDED.child_attendance_id
  RETURNING id INTO v_report_id;

  WITH incoming AS (
    SELECT (e ->> 'curriculum_item_id')::uuid AS curriculum_item_id,
           (e ->> 'mastery_level')::smallint AS mastery_level
    FROM jsonb_array_elements(p_entries) e
  )
  DELETE FROM public.daily_report_items dri
  WHERE dri.report_id = v_report_id
    AND NOT EXISTS (
      SELECT 1 FROM incoming i WHERE i.curriculum_item_id = dri.curriculum_item_id
    );

  INSERT INTO public.daily_report_items (report_id, curriculum_item_id, mastery_level)
  SELECT v_report_id,
         (e ->> 'curriculum_item_id')::uuid,
         (e ->> 'mastery_level')::smallint
  FROM jsonb_array_elements(p_entries) e
  ON CONFLICT (report_id, curriculum_item_id)
  DO UPDATE SET mastery_level = EXCLUDED.mastery_level;

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_daily_report(p_report_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_submitted_at timestamptz;
BEGIN
  SELECT child_attendance_id, submitted_at
    INTO v_attendance_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  IF NOT public.can_write_daily_report(
    public.daily_report_group_id(v_attendance_id),
    public.daily_report_attendance_date(v_attendance_id)
  ) THEN
    RAISE EXCEPTION 'Not authorised to submit reports for this class';
  END IF;

  -- Unchanged, and load-bearing for attribution: a re-submit returns the original timestamp
  -- without touching the row, so submitted_by records the first sender for good.
  IF v_submitted_at IS NOT NULL THEN
    RETURN v_submitted_at;
  END IF;

  UPDATE public.children_daily_reports
    SET submitted_at = now(), submitted_by = auth.uid()
    WHERE id = p_report_id
    RETURNING submitted_at INTO v_submitted_at;

  RETURN v_submitted_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Riwayat Absensi's reader. daily_report_summaries / daily_report_for_slot come from step 1.
-- ---------------------------------------------------------------------------

-- Riwayat Absensi's report: from the absensi row straight to its report. Same signature, same
-- access clause, with the group derived instead of read.
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
  CROSS JOIN LATERAL (SELECT public.daily_report_group_id(a.id) AS group_id) g
  LEFT JOIN public.classroom_teachers ct ON ct.id = g.group_id
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
      -- Last resort: whoever the group belongs to. Covers a teacher account since deleted.
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
      OR g.group_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid()))
      -- The substitute reads back the day she covered, and only that day.
      OR public.is_substitute_for(g.group_id, a.attendance_date)
      OR (
        r.submitted_at IS NOT NULL
        AND r.child_id IN (SELECT public.family_children_ids(auth.uid()))
      )
    )
  -- children_daily_reports_child_attendance_id_key makes this one row at most.
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 8. The two other functions that found reports by group and date.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.withdraw_substitution(p_classroom_teacher_id uuid, p_session_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  SELECT t.id INTO v_teacher_id FROM public.employees t WHERE t.auth_user_id = auth.uid();

  IF NOT v_is_admin AND v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Tidak diizinkan';
  END IF;

  -- Anything already written stays: withdrawing gives up access, it does not undo the work. A
  -- submitted report is the line — once a parent can see it, its author must not be able to walk
  -- away from it.
  --
  -- Scoped to HER OWN submissions now that a group can have several substitutes: a report sent by
  -- the teacher who took the other half of the class says nothing about whether this one may step
  -- back. An admin is still held to any submitted report for the day, because withdrawing someone
  -- else's coverage affects whatever they sent.
  IF EXISTS (
    SELECT 1
    FROM public.children_daily_reports r
    JOIN public.child_attendances a ON a.id = r.child_attendance_id
    WHERE a.attendance_date = p_session_date
      AND public.daily_report_group_id(a.id) = p_classroom_teacher_id
      AND r.submitted_at IS NOT NULL
      AND (v_is_admin OR r.submitted_by = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Laporan sudah dikirim untuk kelas ini pada tanggal tersebut, jadi penggantian tidak bisa dibatalkan';
  END IF;

  -- A teacher may undo only her own coverage; an admin any.
  DELETE FROM public.classroom_teachers_substitutions s
  WHERE s.classroom_teacher_id = p_classroom_teacher_id
    AND s.session_date = p_session_date
    AND (v_is_admin OR s.substitute_teacher_id = v_teacher_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_classroom_teacher_assignment(p_classroom_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not authorised to delete classroom assignments';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.children_classrooms
    WHERE classroom_teacher_id = p_classroom_teacher_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This assignment still has active students; move them to another teacher first';
  END IF;

  -- The group's reports go with it, as before. They must be found before the placements are
  -- deleted, since the placements are what say a report belongs to this group.
  -- daily_report_items cascades from children_daily_reports on its own (ON DELETE CASCADE).
  DELETE FROM public.classroom_teachers_attendances WHERE classroom_teacher_id = p_classroom_teacher_id;
  DELETE FROM public.children_daily_reports r
   WHERE public.daily_report_group_id(r.child_attendance_id) = p_classroom_teacher_id;
  DELETE FROM public.children_classrooms WHERE classroom_teacher_id = p_classroom_teacher_id;

  DELETE FROM public.classroom_teachers WHERE id = p_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Drop the columns. Nothing references them any more.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.children_daily_reports
     WHERE session_id IS NOT NULL OR mood_note IS NOT NULL OR mood_note_parent IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'session_id / mood_note / mood_note_parent hold data; refusing to drop them';
  END IF;

  -- The derived group must agree with the stored one on every report, or teachers would silently
  -- gain or lose reports when the column goes.
  IF EXISTS (
    SELECT 1 FROM public.children_daily_reports r
     WHERE public.daily_report_group_id(r.child_attendance_id) IS DISTINCT FROM r.classroom_teacher_id
  ) THEN
    RAISE EXCEPTION 'Derived teaching group differs from the stored one on some reports';
  END IF;
END;
$$;

ALTER TABLE public.children_daily_reports
  DROP COLUMN session_id,
  DROP COLUMN mood_note,
  DROP COLUMN mood_note_parent,
  DROP COLUMN report_date,
  DROP COLUMN classroom_teacher_id;

COMMENT ON COLUMN public.children_daily_reports.child_attendance_id IS
  'The absensi row this report describes — the report''s identity: one report per absensi row. Its '
  'date, class and teaching group are all read through it (daily_report_attendance_date, '
  'daily_report_group_id).';
COMMENT ON COLUMN public.children_daily_reports.classroom_id IS
  'Copy of the absensi row''s classroom_id, set by the trigger and held equal by '
  'children_daily_reports_attendance_fkey. Do not write it directly.';

-- ---------------------------------------------------------------------------
-- 10. Only the 18 went.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  b record;
BEGIN
  SELECT * INTO b FROM _counts_before;
  IF (SELECT count(*) FROM public.children_daily_reports) <> b.reports - b.orphans
     OR (SELECT count(*) FROM public.child_attendances) <> b.attendances
     OR (SELECT count(*) FROM public.daily_report_items) <> b.items
     OR (SELECT count(*) FROM public.learning_periods) <> b.periods
  THEN
    RAISE EXCEPTION 'Row counts changed beyond the 18 orphaned reports';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.children_daily_reports r WHERE public.daily_report_group_id(r.child_attendance_id) IS NULL
  ) THEN
    RAISE EXCEPTION 'Some reports have no teaching group on their absensi date';
  END IF;
END;
$$;
