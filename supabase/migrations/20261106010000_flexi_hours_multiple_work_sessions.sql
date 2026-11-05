-- Flexi-hours work (Pembuatan Konten) can now be started, finished and started again on the same
-- day, and the day's recorded duration is the SUM of those sessions rather than one span.
--
-- Before this, a flexi day was one clocked_in_at/clocked_out_at pair, so pressing Selesai ended
-- the day for good: the teacher's button disappeared and an afternoon of content work after a
-- morning one simply could not be logged. The two obvious workarounds were both wrong — leaving
-- the session open all day pays for the break, and re-clocking over the morning pair loses it.
--
-- The fix keeps the daily row exactly where it is (every consumer — the admin roster, the monthly
-- PDF, the pay estimate, the correction dialog — is built on one row per classroom_teacher per
-- date, and that contract is unchanged) and adds the individual sessions underneath it:
--
--   classroom_teachers_attendances   09:00 → 15:00   ← first start, last finish. Unchanged shape.
--     └ work_sessions  09:00 → 11:00                 ← 120 min
--     └ work_sessions  13:00 → 15:00                 ← 120 min
--                                       minutes_taught = 240, NOT 360.
--
-- The 11:00–13:00 break is not paid, which is the same rule the rest of this feature already
-- holds to (20260922010000: the business never pays for minutes nobody worked).
--
-- Scheduled classes are untouched. They never get a sessions row, so minutes_taught keeps falling
-- through to the original clocked_out_at − clocked_in_at arithmetic for them, and the clock-in and
-- clock-out windows, the ±5 minute normalisation and the chained handoff all behave exactly as
-- before. The only behavioural fork is inside the two RPCs' existing `IF v_is_flexi_hours` branches.

-- ---------------------------------------------------------------------------
-- The sessions.
-- ---------------------------------------------------------------------------

CREATE TABLE public.classroom_teacher_work_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL
    REFERENCES public.classroom_teachers_attendances(id) ON DELETE CASCADE,

  started_at timestamptz NOT NULL,
  -- NULL means this session is running right now. That is what the teacher's button reads to
  -- decide between Selesai and Lanjutkan, and what stops a second Mulai opening a parallel one.
  ended_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Not `>` as on the parent table: a start and finish inside the same minute is a real (if
  -- pointless) session a teacher can produce by double-tapping, and refusing it would surface as
  -- a raw constraint error on an otherwise harmless tap.
  CONSTRAINT classroom_teacher_work_sessions_ends_after_start
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

COMMENT ON TABLE public.classroom_teacher_work_sessions IS
  'One row per Mulai→Selesai stretch of flexi-hours work (see classrooms.is_flexi_hours), '
  'underneath that day''s classroom_teachers_attendances row. Several per day is the point: the '
  'day''s minutes_taught is their sum, so a break between two sessions is not paid. Scheduled '
  'classrooms never have rows here — their single clock-in/clock-out pair already describes the '
  'whole session.';

COMMENT ON COLUMN public.classroom_teacher_work_sessions.ended_at IS
  'NULL = running right now. At most one session per attendance row may be open at a time '
  '(classroom_teacher_work_sessions_one_open_idx).';

CREATE INDEX classroom_teacher_work_sessions_attendance_id_idx
  ON public.classroom_teacher_work_sessions (attendance_id);

-- The invariant behind the whole button state machine: a day is either running or it is not.
CREATE UNIQUE INDEX classroom_teacher_work_sessions_one_open_idx
  ON public.classroom_teacher_work_sessions (attendance_id)
  WHERE ended_at IS NULL;

GRANT ALL ON public.classroom_teacher_work_sessions TO authenticated, service_role;
ALTER TABLE public.classroom_teacher_work_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_classroom_teacher_work_sessions ON public.classroom_teacher_work_sessions FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Read-only for teachers, exactly as on the parent table: the RPCs below are the only teacher
-- write path, so the time a session records cannot be chosen by the client. The SELECT policy is
-- not optional — classroom_teachers_attendance_status is security_invoker, so its minutes_taught
-- subquery runs as the reader, and a teacher who could not see her own sessions would read every
-- flexi day as 0 minutes.
CREATE POLICY teacher_select_own_classroom_teacher_work_sessions ON public.classroom_teacher_work_sessions FOR SELECT
  USING (
    attendance_id IN (
      SELECT ta.id
      FROM public.classroom_teachers_attendances ta
      WHERE ta.classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- minutes_taught becomes the sum of the day's finished sessions, when there are any.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.classroom_teachers_attendance_status
WITH (security_invoker = true) AS
SELECT
  ta.*,
  (ta.session_date::text || ' ' || c.time_start::text)::timestamp
    AT TIME ZONE 'Asia/Makassar' AS scheduled_start,
  (ta.session_date::text || ' ' || c.time_end::text)::timestamp
    AT TIME ZONE 'Asia/Makassar' AS scheduled_end,
  -- Sessions win when the day has any. The COUNT/SUM pair is one scan, and the fall-through below
  -- keeps every scheduled class — and every flexi day logged before this migration — on the
  -- original arithmetic, so nothing already recorded changes value.
  --
  -- A day whose only session is still running sums no finished sessions and reads NULL, which is
  -- the same "nothing to total yet" the old formula produced between clock-in and clock-out.
  CASE
    WHEN ws.session_count > 0 THEN ws.finished_minutes
    WHEN ta.clocked_in_at IS NULL OR ta.clocked_out_at IS NULL THEN NULL
    ELSE round(extract(epoch FROM (ta.clocked_out_at - ta.clocked_in_at)) / 60)::int
  END AS minutes_taught,
  CASE
    WHEN c.is_flexi_hours THEN 'not_applicable'
    WHEN ta.clocked_in_at IS NULL THEN 'missing'
    WHEN ta.clocked_in_at > (ta.session_date::text || ' ' || c.time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar' + interval '5 minutes' THEN 'late'
    ELSE 'on_time'
  END AS arrival_status,
  CASE
    WHEN c.is_flexi_hours THEN 'not_applicable'
    WHEN ta.clocked_out_at IS NULL THEN 'missing'
    WHEN ta.clocked_out_at < (ta.session_date::text || ' ' || c.time_end::text)::timestamp
      AT TIME ZONE 'Asia/Makassar' - interval '5 minutes' THEN 'early'
    WHEN ta.clocked_out_at > (ta.session_date::text || ' ' || c.time_end::text)::timestamp
      AT TIME ZONE 'Asia/Makassar' + interval '5 minutes' THEN 'overtime'
    ELSE 'on_time'
  END AS departure_status,
  -- Last in the select list on purpose: CREATE OR REPLACE VIEW can only append columns, never
  -- insert one among the existing ones, so a new column goes here however well it reads elsewhere.
  -- Lets a reader tell 240 minutes worked in one stretch from 240 worked in two, which the
  -- clocked_in_at/clocked_out_at pair alone can no longer express. 0 for every scheduled class.
  COALESCE(ws.session_count, 0)::int AS work_session_count
FROM public.classroom_teachers_attendances ta
JOIN public.classroom_teachers ct ON ct.id = ta.classroom_teacher_id
JOIN public.classrooms c ON c.id = ct.classroom_id
LEFT JOIN LATERAL (
  SELECT
    count(*) AS session_count,
    round(sum(extract(epoch FROM (s.ended_at - s.started_at))) FILTER (WHERE s.ended_at IS NOT NULL) / 60)::int
      AS finished_minutes
  FROM public.classroom_teacher_work_sessions s
  WHERE s.attendance_id = ta.id
) ws ON true;

COMMENT ON VIEW public.classroom_teachers_attendance_status IS
  'classroom_teachers_attendances plus the scheduled instants and flags derived from them. '
  'arrival_status/departure_status are flags only, never used to dock pay — payroll stays a '
  'manual process an admin runs off this data. security_invoker so the base table''s and '
  'classrooms''/classroom_teachers'' RLS policies apply to readers of the view. Both statuses '
  'read ''not_applicable'' for an is_flexi_hours classroom (Pembuatan Konten) — there is no real '
  'schedule to be late or early against. minutes_taught is the sum of the day''s finished '
  'classroom_teacher_work_sessions when it has any (so an unpaid break between two flexi '
  'sessions is excluded), and otherwise the plain clocked_out_at − clocked_in_at span.';

-- ---------------------------------------------------------------------------
-- Keeping the daily row and its sessions in agreement.
-- ---------------------------------------------------------------------------

-- Lazily turns a flexi day that predates this migration — or one written straight to the table —
-- into its equivalent single session, so that resuming it adds a second session rather than
-- silently discarding the first. Without this, pressing Lanjutkan on a day logged yesterday would
-- make minutes_taught switch to "sum of sessions" with only the new session in it.
CREATE OR REPLACE FUNCTION public.materialize_flexi_work_session(p_attendance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.classroom_teacher_work_sessions (attendance_id, started_at, ended_at)
  SELECT ta.id, ta.clocked_in_at, ta.clocked_out_at
    FROM public.classroom_teachers_attendances ta
    WHERE ta.id = p_attendance_id
      AND ta.clocked_in_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.classroom_teacher_work_sessions s WHERE s.attendance_id = ta.id
      );
END;
$$;

COMMENT ON FUNCTION public.materialize_flexi_work_session(uuid) IS
  'Converts an attendance row''s existing clocked_in_at/clocked_out_at pair into its first '
  'work-session row, if it has no sessions yet. Idempotent and a no-op once any session exists.';

-- An admin correcting a flexi day in Kehadiran Guru types one Jam Masuk / Jam Selesai pair, which
-- cannot express several sessions. Their correction wins: the day collapses to exactly the single
-- session they typed, and minutes_taught then matches it. Leaving the sessions in place instead
-- would make the correction appear to do nothing at all — the duration would keep coming from the
-- teacher's original sessions.
--
-- The RPCs below maintain their own sessions and raise app.work_sessions_managed around their own
-- writes so this does not undo them. set_config's third argument is `true` = transaction-local, and
-- each RPC clears the flag again before returning: PostgREST would end the transaction anyway, but
-- a flag left raised would silently disable this trigger for every later write in the same
-- transaction — which is exactly what a test, a migration or a future RPC that calls one of these
-- and then touches the table would run into.
CREATE OR REPLACE FUNCTION public.sync_flexi_work_sessions_from_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_flexi_hours boolean;
BEGIN
  IF current_setting('app.work_sessions_managed', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.clocked_in_at IS NOT DISTINCT FROM OLD.clocked_in_at
     AND NEW.clocked_out_at IS NOT DISTINCT FROM OLD.clocked_out_at THEN
    RETURN NULL;
  END IF;

  SELECT c.is_flexi_hours
    INTO v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = NEW.classroom_teacher_id;

  -- Scheduled classes keep no sessions at all: their one pair already is the session, and giving
  -- them rows here would only move minutes_taught onto a second code path for no gain.
  IF NOT COALESCE(v_is_flexi_hours, false) THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.classroom_teacher_work_sessions WHERE attendance_id = NEW.id;

  IF NEW.clocked_in_at IS NOT NULL THEN
    INSERT INTO public.classroom_teacher_work_sessions (attendance_id, started_at, ended_at)
    VALUES (NEW.id, NEW.clocked_in_at, NEW.clocked_out_at);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_flexi_work_sessions ON public.classroom_teachers_attendances;

CREATE TRIGGER sync_flexi_work_sessions
  AFTER INSERT OR UPDATE ON public.classroom_teachers_attendances
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_flexi_work_sessions_from_attendance();

-- ---------------------------------------------------------------------------
-- clock_in_classroom_teacher: the flexi branch becomes Mulai *and* Lanjutkan.
--
-- Everything else is copied unchanged from 20260922010000_teacher_attendance_no_early_credit.sql:
-- authorisation, the 60-minute floor, the ±5 minute on-time normalisation, and — for a scheduled
-- class — the ON CONFLICT DO NOTHING that keeps a second tap from shifting a recorded time.
--
-- That idempotency is exactly what must NOT hold for flexi any more. A second tap there is no
-- longer a stray double-press to swallow; it is the teacher coming back after lunch, and it opens
-- a new session. A tap while a session is already running still does nothing, so a genuine
-- double-press is still harmless.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.clock_in_classroom_teacher(p_classroom_teacher_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_time_start time;
  v_is_flexi_hours boolean;
  v_session_date date;
  v_scheduled_start timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
  v_has_open_session boolean;
BEGIN
  SELECT t.id, c.time_start, c.is_flexi_hours
    INTO v_teacher_id, v_time_start, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock in for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  IF v_is_flexi_hours THEN
    -- No schedule to validate or normalise against — any time, any day.
    v_recorded_at := now();
  ELSE
    v_scheduled_start := (v_session_date::text || ' ' || v_time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar';

    IF now() < v_scheduled_start - interval '60 minutes' THEN
      RAISE EXCEPTION 'Belum waktunya absen masuk (mulai 1 jam sebelum jadwal kelas dimulai)';
    END IF;

    v_recorded_at := CASE
      WHEN now() <= v_scheduled_start + interval '5 minutes' THEN v_scheduled_start
      ELSE now()
    END;
  END IF;

  PERFORM set_config('app.work_sessions_managed', 'on', true);

  -- Idempotent for a scheduled class: a second tap must not shift an already-recorded time.
  INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
  VALUES (p_classroom_teacher_id, v_session_date, v_recorded_at, 'teacher')
  ON CONFLICT ON CONSTRAINT classroom_teachers_attendances_key DO NOTHING;

  SELECT id INTO v_id
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_classroom_teacher_id AND session_date = v_session_date;

  IF v_is_flexi_hours THEN
    PERFORM public.materialize_flexi_work_session(v_id);

    SELECT EXISTS (
      SELECT 1 FROM public.classroom_teacher_work_sessions
      WHERE attendance_id = v_id AND ended_at IS NULL
    ) INTO v_has_open_session;

    -- Already running: a double-tap, nothing to do. The one-open-session unique index would refuse
    -- the insert below anyway; checking here turns that into a quiet no-op rather than an error.
    IF NOT v_has_open_session THEN
      INSERT INTO public.classroom_teacher_work_sessions (attendance_id, started_at)
      VALUES (v_id, v_recorded_at);

      -- The day is running again, so it has no finish time until she presses Selesai.
      -- clocked_in_at keeps pointing at the FIRST session's start — it is the day's "jam masuk" on
      -- every screen and in the monthly PDF, and the paid total comes from the sessions, not from
      -- this pair.
      UPDATE public.classroom_teachers_attendances
        SET clocked_out_at = NULL,
            clocked_out_source = NULL
        WHERE id = v_id AND clocked_out_at IS NOT NULL;
    END IF;
  END IF;

  -- Lowered again on the way out, not left raised for whatever else shares this transaction.
  PERFORM set_config('app.work_sessions_managed', '', true);

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_in_classroom_teacher(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- clock_out_classroom_teacher: the flexi branch closes the running session as well as the day.
--
-- The scheduled-class path — the end−5min floor, the ±5 minute normalisation, the COALESCE
-- idempotency — is copied unchanged from 20260815010000_classrooms_billable_and_flexi_hours.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.clock_out_classroom_teacher(p_classroom_teacher_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_time_end time;
  v_is_flexi_hours boolean;
  v_session_date date;
  v_scheduled_end timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
  v_clocked_in_at timestamptz;
  v_open_session_id uuid;
BEGIN
  SELECT t.id, c.time_end, c.is_flexi_hours
    INTO v_teacher_id, v_time_end, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock out for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  SELECT id, clocked_in_at INTO v_id, v_clocked_in_at
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_classroom_teacher_id AND session_date = v_session_date;

  IF v_id IS NULL OR v_clocked_in_at IS NULL THEN
    RAISE EXCEPTION 'Belum absen masuk untuk kelas ini hari ini';
  END IF;

  IF v_is_flexi_hours THEN
    v_recorded_at := now();
  ELSE
    v_scheduled_end := (v_session_date::text || ' ' || v_time_end::text)::timestamp
      AT TIME ZONE 'Asia/Makassar';

    IF now() < v_scheduled_end - interval '5 minutes' THEN
      RAISE EXCEPTION 'Belum waktunya absen selesai (mulai 5 menit sebelum jadwal kelas berakhir)';
    END IF;

    v_recorded_at := CASE
      WHEN now() <= v_scheduled_end + interval '5 minutes' THEN v_scheduled_end
      ELSE now()
    END;
  END IF;

  PERFORM set_config('app.work_sessions_managed', 'on', true);

  IF v_is_flexi_hours THEN
    PERFORM public.materialize_flexi_work_session(v_id);

    SELECT id INTO v_open_session_id
      FROM public.classroom_teacher_work_sessions
      WHERE attendance_id = v_id AND ended_at IS NULL;

    -- Nothing running: the day is already finished and this is a double-tap. Left alone rather
    -- than reopened — Lanjutkan is the button that starts the next session.
    IF v_open_session_id IS NULL THEN
      PERFORM set_config('app.work_sessions_managed', '', true);
      RETURN v_id;
    END IF;

    UPDATE public.classroom_teacher_work_sessions
      SET ended_at = GREATEST(v_recorded_at, started_at)
      WHERE id = v_open_session_id;
  END IF;

  -- Idempotent, same reasoning as clock-in: COALESCE leaves an existing clock-out untouched. On a
  -- resumed flexi day clocked_out_at was set back to NULL when the session opened, so this records
  -- the new finish rather than keeping the morning's.
  UPDATE public.classroom_teachers_attendances
    SET clocked_out_at = COALESCE(clocked_out_at, v_recorded_at),
        clocked_out_source = COALESCE(clocked_out_source, 'teacher')
    WHERE id = v_id;

  -- Lowered again on the way out, not left raised for whatever else shares this transaction.
  PERFORM set_config('app.work_sessions_managed', '', true);

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_out_classroom_teacher(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_flexi_work_session(uuid) TO authenticated, service_role;
