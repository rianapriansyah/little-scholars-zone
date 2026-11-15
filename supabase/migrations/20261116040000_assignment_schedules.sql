-- Phase 3a of the employee work refactor: one place that says when and how an assignment is worked.
--
-- Until now every clock-in rule read its schedule from the classroom (classrooms.time_start,
-- time_end, is_flexi_hours, active), which is why staff work had to be faked as classrooms. Staff
-- work now has its own work item and its own times on the assignment (20261116020000), so:
--
--   * classroom_teachers.is_flexi_hours: the flexi flag of a work-item assignment (Konten and
--     Aktivitas Sore-Malam are flexi today). Teaching keeps reading it from the class.
--   * view employee_assignment_schedules: per assignment, its label, start, end, flexi flag,
--     billable flag and active state. For staff work these come from the assignment and its work
--     item; for teaching, from the class. The work item wins when both are set.
--   * the clock-in, clock-out, chained clock-out, substitution, time-normalising and flexi-session
--     functions and the attendance status view now read the schedule from that view. Each was
--     rebuilt from its production definition with only the schedule source swapped.
--
-- Nothing changes today: the 26 staff-work assignments still sit on their old classroom, and their
-- own times and flexi flag are copied from it. The check at the end proves it: every attendance
-- row's scheduled times, minutes and statuses are identical before and after. Phase 3c then takes
-- the staff work off its classrooms without any of these rules noticing.
--
-- Rollback: supabase/rollbacks/20261116040000_assignment_schedules.sql

-- What the status view says today, to compare against at the end.
CREATE TEMP TABLE status_before ON COMMIT DROP AS
SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
FROM public.classroom_teachers_attendance_status;

ALTER TABLE public.classroom_teachers ADD COLUMN is_flexi_hours boolean;

UPDATE public.classroom_teachers ct
SET is_flexi_hours = c.is_flexi_hours
FROM public.classrooms c
WHERE c.id = ct.classroom_id AND ct.work_item_id IS NOT NULL;

ALTER TABLE public.classroom_teachers
  ADD CONSTRAINT classroom_teachers_work_item_flexi_check
    CHECK (work_item_id IS NULL OR is_flexi_hours IS NOT NULL);

COMMENT ON COLUMN public.classroom_teachers.is_flexi_hours IS
  'Flexi hours for a work-item assignment (no fixed schedule to be late or early against). '
  'NULL for teaching, which reads it from the class.';

CREATE VIEW public.employee_assignment_schedules
WITH (security_invoker = true) AS
SELECT
  ct.id           AS classroom_teacher_id,
  ct.teacher_id   AS employee_id,
  ct.classroom_id,
  ct.work_item_id,
  CASE WHEN ct.work_item_id IS NOT NULL THEN w.name || ' — ' || b.name ELSE c.label END AS label,
  CASE WHEN ct.work_item_id IS NOT NULL THEN ct.time_start ELSE c.time_start END AS time_start,
  CASE WHEN ct.work_item_id IS NOT NULL THEN ct.time_end ELSE c.time_end END AS time_end,
  CASE WHEN ct.work_item_id IS NOT NULL THEN ct.is_flexi_hours ELSE c.is_flexi_hours END AS is_flexi_hours,
  CASE WHEN ct.work_item_id IS NOT NULL THEN false ELSE c.is_billable END AS is_billable,
  CASE WHEN ct.work_item_id IS NOT NULL THEN w.active ELSE c.active END AS active
FROM public.classroom_teachers ct
LEFT JOIN public.classrooms c ON c.id = ct.classroom_id
LEFT JOIN public.work_items w ON w.id = ct.work_item_id
LEFT JOIN public.office_branch b ON b.id = w.branch_id;

REVOKE ALL ON public.employee_assignment_schedules FROM PUBLIC, anon;
GRANT SELECT ON public.employee_assignment_schedules TO authenticated, service_role;

COMMENT ON VIEW public.employee_assignment_schedules IS
  'When and how each assignment is worked: label, times, flexi, billable, active. Staff work reads '
  'its work item and its own times; teaching reads its class. Every clock-in rule reads this view. '
  'security_invoker, so app callers see only the assignments their RLS allows.';
CREATE OR REPLACE FUNCTION public.clock_in_classroom_teacher(p_classroom_teacher_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_teacher_id uuid;
  v_time_start time;
  v_is_flexi_hours boolean;
  v_session_date date;
  v_scheduled_start timestamptz;
  v_recorded_at timestamptz;
  v_id uuid;
  v_has_open_session boolean;
  v_previous_end timestamptz;
BEGIN
  SELECT t.id, s.time_start, s.is_flexi_hours
    INTO v_teacher_id, v_time_start, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.employees t ON t.id = ct.teacher_id
    JOIN public.employee_assignment_schedules s ON s.classroom_teacher_id = ct.id
    WHERE ct.id = p_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised to clock in for this class';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  IF v_is_flexi_hours THEN
    -- No schedule to validate or normalise against — any time, any day. The time is the one the
    -- teacher picked, or the tap itself when she did not send one.
    v_recorded_at := COALESCE(p_at, now());

    IF v_recorded_at > now() + interval '1 minute' THEN
      RAISE EXCEPTION 'Waktu mulai tidak boleh melebihi waktu sekarang';
    END IF;
    IF (v_recorded_at AT TIME ZONE 'Asia/Makassar')::date <> v_session_date THEN
      RAISE EXCEPTION 'Waktu mulai harus hari ini';
    END IF;
  ELSE
    IF p_at IS NOT NULL THEN
      RAISE EXCEPTION 'Waktu hanya bisa dipilih untuk jadwal fleksibel';
    END IF;

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
      -- Lanjutkan: the new session may not start inside the one before it.
      SELECT max(ended_at) INTO v_previous_end
        FROM public.classroom_teacher_work_sessions
        WHERE attendance_id = v_id;

      IF v_previous_end IS NOT NULL AND v_recorded_at < v_previous_end THEN
        RAISE EXCEPTION 'Waktu mulai tidak boleh sebelum sesi sebelumnya selesai (%)',
          to_char(v_previous_end AT TIME ZONE 'Asia/Makassar', 'HH24:MI');
      END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.clock_out_and_continue_classroom_teacher(p_from_classroom_teacher_id uuid, p_to_classroom_teacher_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_teacher_id uuid;
  v_to_teacher_id uuid;
  v_from_time_end time;
  v_to_time_start time;
  v_session_date date;
  v_boundary timestamptz;
  v_from_id uuid;
  v_from_clocked_in_at timestamptz;
  v_to_id uuid;
BEGIN
  -- Both classes must belong to the same caller — this can never be used to chain (or peek at)
  -- another teacher's schedule.
  SELECT t.id, s.time_end
    INTO v_teacher_id, v_from_time_end
    FROM public.classroom_teachers ct
    JOIN public.employees t ON t.id = ct.teacher_id
    JOIN public.employee_assignment_schedules s ON s.classroom_teacher_id = ct.id
    WHERE ct.id = p_from_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised for the source class';
  END IF;

  SELECT t.id, s.time_start
    INTO v_to_teacher_id, v_to_time_start
    FROM public.classroom_teachers ct
    JOIN public.employees t ON t.id = ct.teacher_id
    JOIN public.employee_assignment_schedules s ON s.classroom_teacher_id = ct.id
    WHERE ct.id = p_to_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_to_teacher_id IS NULL OR v_to_teacher_id <> v_teacher_id THEN
    RAISE EXCEPTION 'Not authorised for the destination class';
  END IF;

  -- The server independently confirms the two classes are genuinely back-to-back, rather than
  -- trusting the client's pairing. This is also what makes the single v_boundary below sound.
  IF v_from_time_end IS DISTINCT FROM v_to_time_start THEN
    RAISE EXCEPTION 'Classes are not back-to-back; cannot continue directly';
  END IF;

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;
  v_boundary := (v_session_date::text || ' ' || v_from_time_end::text)::timestamp
    AT TIME ZONE 'Asia/Makassar';

  -- Same floor as a plain clock-out: tapping "lanjut" is still a clock-out of the source class and
  -- must respect the same payroll-integrity floor, not let her close it out early. Only the floor
  -- is kept — once past it, the recorded value is the boundary regardless of when she taps, so
  -- there is no upper bound to check.
  IF now() < v_boundary - interval '5 minutes' THEN
    RAISE EXCEPTION 'Belum waktunya absen selesai (mulai 5 menit sebelum jadwal kelas berakhir)';
  END IF;

  SELECT id, clocked_in_at INTO v_from_id, v_from_clocked_in_at
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_from_classroom_teacher_id AND session_date = v_session_date;

  IF v_from_id IS NULL OR v_from_clocked_in_at IS NULL THEN
    RAISE EXCEPTION 'Belum absen masuk untuk kelas ini hari ini';
  END IF;

  -- Close the source class at the boundary — idempotent, same COALESCE reasoning as
  -- clock_out_classroom_teacher.
  --
  -- GREATEST guards the one case where the boundary is not a sane clock-out: a class clocked into
  -- *after* it had already ended (the Masuk Kelas window never closes, so tapping in at 10:30 on an
  -- 08:00-10:00 class is reachable), which would otherwise record a clock-out before its own
  -- clock-in. The trigger backstops this too; doing it here as well keeps the RPC readable on its
  -- own terms.
  UPDATE public.classroom_teachers_attendances
    SET clocked_out_at = COALESCE(clocked_out_at, GREATEST(v_boundary, v_from_clocked_in_at)),
        clocked_out_source = COALESCE(clocked_out_source, 'teacher')
    WHERE id = v_from_id;

  -- Open the destination class at that same boundary. No clock-in window check: she's continuing
  -- straight out of the adjacent class she was just teaching, so there is no gap in which she could
  -- be "late", and the recorded instant is the destination's own scheduled start by construction.
  -- Idempotent, same ON CONFLICT DO NOTHING reasoning as clock_in_classroom_teacher — a
  -- destination she had already clocked into herself keeps her own time.
  INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
  VALUES (p_to_classroom_teacher_id, v_session_date, v_boundary, 'teacher')
  ON CONFLICT ON CONSTRAINT classroom_teachers_attendances_key DO NOTHING;

  SELECT id INTO v_to_id
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_to_classroom_teacher_id AND session_date = v_session_date;

  RETURN v_to_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clock_out_classroom_teacher(p_classroom_teacher_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_open_session_start timestamptz;
BEGIN
  SELECT t.id, s.time_end, s.is_flexi_hours
    INTO v_teacher_id, v_time_end, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.employees t ON t.id = ct.teacher_id
    JOIN public.employee_assignment_schedules s ON s.classroom_teacher_id = ct.id
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
    v_recorded_at := COALESCE(p_at, now());

    IF v_recorded_at > now() + interval '1 minute' THEN
      RAISE EXCEPTION 'Waktu selesai tidak boleh melebihi waktu sekarang';
    END IF;
    IF (v_recorded_at AT TIME ZONE 'Asia/Makassar')::date <> v_session_date THEN
      RAISE EXCEPTION 'Waktu selesai harus hari ini';
    END IF;
  ELSE
    IF p_at IS NOT NULL THEN
      RAISE EXCEPTION 'Waktu hanya bisa dipilih untuk jadwal fleksibel';
    END IF;

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

    SELECT id, started_at INTO v_open_session_id, v_open_session_start
      FROM public.classroom_teacher_work_sessions
      WHERE attendance_id = v_id AND ended_at IS NULL;

    -- Nothing running: the day is already finished and this is a double-tap. Left alone rather
    -- than reopened — Lanjutkan is the button that starts the next session.
    IF v_open_session_id IS NULL THEN
      PERFORM set_config('app.work_sessions_managed', '', true);
      RETURN v_id;
    END IF;

    -- A picked time can land before the session began; refuse it rather than record a negative
    -- (or silently zero-length) stretch of work.
    IF v_recorded_at < v_open_session_start THEN
      RAISE EXCEPTION 'Waktu selesai tidak boleh sebelum waktu mulai sesi ini (%)',
        to_char(v_open_session_start AT TIME ZONE 'Asia/Makassar', 'HH24:MI');
    END IF;

    UPDATE public.classroom_teacher_work_sessions
      SET ended_at = v_recorded_at
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
$function$;

CREATE OR REPLACE FUNCTION public.declare_substitution(p_classroom_teacher_id uuid, p_session_date date, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_teacher_id uuid;
  v_today date;
  v_classroom_id uuid;
  v_assigned_teacher_id uuid;
  v_time_start time;
  v_time_end time;
  v_is_flexi_hours boolean;
  v_active boolean;
  v_scheduled_start timestamptz;
  v_existing_id uuid;
  v_id uuid;
BEGIN
  SELECT t.id INTO v_teacher_id
    FROM public.employees t
    WHERE t.auth_user_id = auth.uid() AND t.active;
  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Hanya guru aktif yang bisa menggantikan kelas';
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Makassar')::date;

  -- The one hard limit. Attendance consumes a paid quota, so a class that has not happened cannot
  -- be covered, written up, or billed for.
  IF p_session_date > v_today THEN
    RAISE EXCEPTION 'Tidak bisa menggantikan kelas untuk tanggal yang belum terjadi';
  END IF;

  SELECT ct.classroom_id, ct.teacher_id, s.time_start, s.time_end, s.is_flexi_hours, s.active
    INTO v_classroom_id, v_assigned_teacher_id, v_time_start, v_time_end, v_is_flexi_hours, v_active
    FROM public.classroom_teachers ct
    JOIN public.employee_assignment_schedules s ON s.classroom_teacher_id = ct.id
    WHERE ct.id = p_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kelas tidak ditemukan';
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'Kelas ini sudah tidak aktif';
  END IF;

  -- The trigger would catch this too, but a named message is kinder than a constraint error.
  IF v_assigned_teacher_id = v_teacher_id THEN
    RAISE EXCEPTION 'Ini kelas Anda sendiri, tidak perlu pengganti';
  END IF;

  -- A flexi-hours class has no schedule to judge a day or a window against — see
  -- clock_in_classroom_teacher, which skips the same two checks for the same reason.
  IF NOT v_is_flexi_hours THEN
    IF extract(isodow FROM p_session_date) > 5 THEN
      RAISE EXCEPTION 'Kelas hanya berjalan hari Senin sampai Jumat';
    END IF;

    -- Only meaningful for today. On a past date the class has already run, which is the whole
    -- point of being able to pick one.
    IF p_session_date = v_today THEN
      v_scheduled_start := (p_session_date::text || ' ' || v_time_start::text)::timestamp
        AT TIME ZONE 'Asia/Makassar';

      IF now() < v_scheduled_start - interval '60 minutes' THEN
        RAISE EXCEPTION 'Belum waktunya menggantikan kelas ini (mulai 1 jam sebelum jadwal kelas dimulai)';
      END IF;
    END IF;
  END IF;

  -- Idempotent for the same substitute: a second tap of the button returns what she already has.
  -- Another teacher already covering this group is NOT a conflict any more — her children are
  -- split between whoever is left, so each of them declares in turn.
  SELECT s.id INTO v_existing_id
    FROM public.classroom_teachers_substitutions s
    WHERE s.classroom_teacher_id = p_classroom_teacher_id
      AND s.session_date = p_session_date
      AND s.substitute_teacher_id = v_teacher_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- The assigned teacher must genuinely have been absent that day. If she clocked in, she taught
  -- it, and this is not a coverage situation.
  IF EXISTS (
    SELECT 1
    FROM public.classroom_teachers_attendances ta
    WHERE ta.classroom_teacher_id = p_classroom_teacher_id
      AND ta.session_date = p_session_date
      AND ta.clocked_in_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Guru kelas ini sudah absen masuk pada tanggal tersebut';
  END IF;

  -- She cannot have been in two rooms at once: refuse a class whose schedule overlaps one she held
  -- on that date, as her own group or as another coverage. Flexi-hours classes have no meaningful
  -- schedule, so they are left out of the comparison on both sides.
  -- Compared assignment by assignment (each with its own schedule: the class's, or the work
  -- item's own times), skipping every assignment of this same class as before.
  IF NOT v_is_flexi_hours AND EXISTS (
    SELECT 1
    FROM public.employee_assignment_schedules other
    WHERE other.classroom_id IS DISTINCT FROM v_classroom_id
      AND NOT other.is_flexi_hours
      AND other.time_start < v_time_end
      AND other.time_end > v_time_start
      AND (
        other.employee_id = v_teacher_id
        OR EXISTS (
          SELECT 1
          FROM public.classroom_teachers_substitutions s2
          WHERE s2.classroom_teacher_id = other.classroom_teacher_id
            AND s2.session_date = p_session_date
            AND s2.substitute_teacher_id = v_teacher_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Jadwal kelas ini bentrok dengan kelas Anda yang lain pada tanggal tersebut';
  END IF;

  INSERT INTO public.classroom_teachers_substitutions (
    classroom_teacher_id, substitute_teacher_id, session_date,
    counts_for_pay, created_by_role, reason, created_by
  )
  VALUES (
    p_classroom_teacher_id, v_teacher_id, p_session_date,
    public.default_counts_for_pay(p_classroom_teacher_id, v_teacher_id),
    'teacher', NULLIF(btrim(p_reason), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_classroom_teacher_attendance_times()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_time_start time;
  v_is_flexi_hours boolean;
  v_scheduled_start timestamptz;
BEGIN
  IF NEW.clocked_in_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.time_start, s.is_flexi_hours
    INTO v_time_start, v_is_flexi_hours
    FROM public.employee_assignment_schedules s
    WHERE s.classroom_teacher_id = NEW.classroom_teacher_id;

  -- Skipped for an is_flexi_hours program (Pembuatan Konten): it has no real start to be early
  -- against — its nominal time_start is display only, so clamping to it would invent hours nobody
  -- worked.
  IF v_time_start IS NOT NULL AND NOT v_is_flexi_hours THEN
    v_scheduled_start := (NEW.session_date::text || ' ' || v_time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar';

    IF NEW.clocked_in_at < v_scheduled_start THEN
      NEW.clocked_in_at := v_scheduled_start;
    END IF;
  END IF;

  -- Outside the branch above, so "minutes_taught is never negative" is an invariant of the table
  -- rather than something each of the three write paths has to remember. Two ways in: a
  -- hand-entered pair that ends before the class even starts (07:30–07:45 against an 08:00 class,
  -- raised to 08:00–08:00), and a chained clock-out written at the scheduled boundary on a class
  -- whose clock-in landed after that boundary. Either way a zero-minute session is the safe
  -- reading — a negative one silently subtracts from the month's total durasi and the estimate.
  IF NEW.clocked_out_at IS NOT NULL AND NEW.clocked_out_at < NEW.clocked_in_at THEN
    NEW.clocked_out_at := NEW.clocked_in_at;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_flexi_work_sessions_from_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT s.is_flexi_hours
    INTO v_is_flexi_hours
    FROM public.employee_assignment_schedules s
    WHERE s.classroom_teacher_id = NEW.classroom_teacher_id;

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
$function$;

CREATE OR REPLACE VIEW public.classroom_teachers_attendance_status AS
SELECT ta.id,
    ta.classroom_teacher_id,
    ta.session_date,
    ta.clocked_in_at,
    ta.clocked_in_source,
    ta.clocked_out_at,
    ta.clocked_out_source,
    ta.edited_by,
    ta.notes,
    ta.created_at,
    ((((ta.session_date::text || ' '::text) || s.time_start::text)::timestamp without time zone) AT TIME ZONE 'Asia/Makassar'::text) AS scheduled_start,
    ((((ta.session_date::text || ' '::text) || s.time_end::text)::timestamp without time zone) AT TIME ZONE 'Asia/Makassar'::text) AS scheduled_end,
        CASE
            WHEN ws.session_count > 0 THEN ws.finished_minutes
            WHEN ta.clocked_in_at IS NULL OR ta.clocked_out_at IS NULL THEN NULL::integer
            ELSE round(EXTRACT(epoch FROM ta.clocked_out_at - ta.clocked_in_at) / 60::numeric)::integer
        END AS minutes_taught,
        CASE
            WHEN s.is_flexi_hours THEN 'not_applicable'::text
            WHEN ta.clocked_in_at IS NULL THEN 'missing'::text
            WHEN ta.clocked_in_at > (((((ta.session_date::text || ' '::text) || s.time_start::text)::timestamp without time zone) AT TIME ZONE 'Asia/Makassar'::text) + '00:05:00'::interval) THEN 'late'::text
            ELSE 'on_time'::text
        END AS arrival_status,
        CASE
            WHEN s.is_flexi_hours THEN 'not_applicable'::text
            WHEN ta.clocked_out_at IS NULL THEN 'missing'::text
            WHEN ta.clocked_out_at < (((((ta.session_date::text || ' '::text) || s.time_end::text)::timestamp without time zone) AT TIME ZONE 'Asia/Makassar'::text) - '00:05:00'::interval) THEN 'early'::text
            WHEN ta.clocked_out_at > (((((ta.session_date::text || ' '::text) || s.time_end::text)::timestamp without time zone) AT TIME ZONE 'Asia/Makassar'::text) + '00:05:00'::interval) THEN 'overtime'::text
            ELSE 'on_time'::text
        END AS departure_status,
    COALESCE(ws.session_count, 0::bigint)::integer AS work_session_count
   FROM classroom_teachers_attendances ta
     JOIN classroom_teachers ct ON ct.id = ta.classroom_teacher_id
     JOIN public.employee_assignment_schedules s ON s.classroom_teacher_id = ct.id
     LEFT JOIN LATERAL ( SELECT count(*) AS session_count,
            round(sum(EXTRACT(epoch FROM s.ended_at - s.started_at)) FILTER (WHERE s.ended_at IS NOT NULL) / 60::numeric)::integer AS finished_minutes
           FROM classroom_teacher_work_sessions s
          WHERE s.attendance_id = ta.id) ws ON true;

-- ── checks ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n bigint;
BEGIN
  -- Every assignment has a schedule.
  SELECT count(*) INTO n FROM public.employee_assignment_schedules
   WHERE time_start IS NULL OR time_end IS NULL OR is_flexi_hours IS NULL OR active IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% assignments have no complete schedule', n; END IF;

  -- Staff work: its own times and flexi flag equal its old classroom's, so nothing moves today.
  SELECT count(*) INTO n
  FROM public.classroom_teachers ct JOIN public.classrooms c ON c.id = ct.classroom_id
  WHERE ct.work_item_id IS NOT NULL
    AND (ct.time_start <> c.time_start OR ct.time_end <> c.time_end OR ct.is_flexi_hours <> c.is_flexi_hours);
  IF n > 0 THEN RAISE EXCEPTION '% staff-work assignments differ from their classroom schedule', n; END IF;

  -- The status view says exactly what it said before, row for row.
  SELECT count(*) INTO n FROM (
    (SELECT * FROM status_before
     EXCEPT
     SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
     FROM public.classroom_teachers_attendance_status)
    UNION ALL
    (SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
     FROM public.classroom_teachers_attendance_status
     EXCEPT
     SELECT * FROM status_before)
  ) d;
  IF n > 0 THEN RAISE EXCEPTION 'Attendance status changed for % rows', n; END IF;
END;
$$;
