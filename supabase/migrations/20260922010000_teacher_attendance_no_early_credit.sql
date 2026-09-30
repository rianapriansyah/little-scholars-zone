-- Owner rule: a teacher is never paid for time before her class actually starts. Arriving early
-- is fine, and she can log it whenever she likes, but the recorded jam masuk is always the
-- class's own start time. Only time on the *other* end — past the scheduled end — is real
-- overtime and counts.
--
--   Kelas 1: 08:00–10:00.  Guru taps masuk 07:30, taps selesai 10:15.
--   Recorded: clocked_in_at = 08:00 (the class start), clocked_out_at = 10:15 (real overtime).
--
-- The plain clock-out already worked this way (20260810050000 / 20260811010000 normalise an
-- on-time tap to exactly scheduled_end and keep the real time only once it is genuinely past it).
-- The chained one did not, and part 3 below fixes that on the owner's instruction.
--
-- 1. A BEFORE trigger, not another edit to each RPC. There are three write paths into
--    classroom_teachers_attendances — clock_in_classroom_teacher, the destination clock-in inside
--    clock_out_and_continue_classroom_teacher, and the admin's plain upsert from the Kehadiran
--    Guru correction dialog — and until now each carried its own (or, for the latter two, no)
--    normalisation. One trigger makes the rule true of the table itself, so no write path can
--    quietly produce pre-start minutes again. In particular:
--      * clock_out_and_continue previously opened the next class at the real tap instant, which
--        can be up to 5 minutes before that class's own start (the clock-out floor is end − 5min);
--        that silent head start is now clamped away too.
--      * An admin typing 07:30 into Jam Masuk for an 08:00 class stores 08:00. This is a
--        deliberate departure from the 20260811020000 backfill's "never touch admin entries"
--        scope: the owner's rule is about what the business counts, not about who typed it, so it
--        has to hold for a hand-entered correction as well. Pulang Cepat (an early *departure*)
--        is untouched and still recordable — only the start side has a floor.
--
-- 2. Masuk Kelas's floor moves from 5 minutes to 60 minutes before the scheduled start. The
--    5-minute floor existed to stop a teacher banking free minutes by tapping in early; with the
--    clamp above there is nothing left to bank, so the only thing it still did was refuse a
--    teacher who was genuinely standing in the room early and force an admin backfill. An hour is
--    wide enough for a real early arrival while still keeping the tap on the same side of the day
--    as the class it belongs to.
--
-- 3. "Selesaikan kelas dan lanjut ke kelas selanjutnya" records BOTH sides of the handoff at the
--    scheduled boundary, not at the tap instant. On the owner's schedule — Piket Pagi 07:00-08:00,
--    a class 08:00-10:00, a class 10:00-12:00 — every transition is a chain link, and the boundary
--    is a single instant that is simultaneously one class's scheduled end and the next's scheduled
--    start. Tapping "lanjut" at 10:04 (or 09:56) now closes the 08:00 class at exactly 10:00 and
--    opens the 10:00 class at exactly 10:00.
--
--    Previously it wrote the raw tap instant to both, which leaked minutes in whichever direction
--    the tap fell: at 09:56 the first class lost 4 minutes and the second was paid 4 minutes
--    before it began; at 10:04 the first banked 4 minutes it had not taught and the second started
--    4 minutes short. Note the day's total was roughly preserved either way — the numbers were
--    wrong per class, which is what the monthly per-class table and the estimate are built on.
--
--    This is deliberately NOT the plain Selesaikan Kelas behaviour. Saying "lanjut" is an
--    assertion that one class ran into the next with no gap, so the scheduled boundary is the
--    truthful record of when each ended and began. Saying "Selesaikan kelas" (the other button) is
--    the teacher going home, and there the real time is still kept and still reads as Over Time —
--    that is genuine overtime, not a handoff.

-- ---------------------------------------------------------------------------
-- The clamp.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_classroom_teacher_attendance_times()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY DEFINER so the lookup below works no matter who is writing the row. The admin upsert
-- arrives as plain `authenticated` rather than through a SECURITY DEFINER RPC, and must not be
-- able to skip the clamp just because its own RLS view of classrooms/classroom_teachers is
-- narrower. Reads two columns of the row's own classroom and writes nothing else.
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_time_start time;
  v_is_flexi_hours boolean;
  v_scheduled_start timestamptz;
BEGIN
  IF NEW.clocked_in_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.time_start, c.is_flexi_hours
    INTO v_time_start, v_is_flexi_hours
    FROM public.classroom_teachers ct
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = NEW.classroom_teacher_id;

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
$$;

COMMENT ON FUNCTION public.normalize_classroom_teacher_attendance_times() IS
  'Raises a clocked_in_at that falls before its classroom''s scheduled start up to that start, so '
  'no write path can record paid minutes earlier than the class itself (skipped for '
  'is_flexi_hours classrooms, which have no real schedule), and never lets clocked_out_at sit '
  'before clocked_in_at. Time past the scheduled END is deliberately left alone — that is genuine '
  'overtime and is kept real, except on a chained handoff, where '
  'clock_out_and_continue_classroom_teacher writes the scheduled boundary itself.';

DROP TRIGGER IF EXISTS normalize_attendance_times ON public.classroom_teachers_attendances;
-- Belt and braces in case an earlier draft of this migration was applied by hand: the trigger and
-- its function were renamed when the non-negative guard above widened the job beyond the clock-in
-- clamp. The trigger has to go before the function it depends on.
DROP TRIGGER IF EXISTS clamp_early_clock_in ON public.classroom_teachers_attendances;
DROP FUNCTION IF EXISTS public.clamp_classroom_teacher_attendance_early_clock_in();

CREATE TRIGGER normalize_attendance_times
  BEFORE INSERT OR UPDATE ON public.classroom_teachers_attendances
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_classroom_teacher_attendance_times();

-- ---------------------------------------------------------------------------
-- clock_in_classroom_teacher: floor widened to 60 minutes. Everything else — authorisation, the
-- is_flexi_hours bypass, the ±5 minute on-time normalisation, idempotency — is copied unchanged
-- from 20260815010000_classrooms_billable_and_flexi_hours.sql.
--
-- The CASE keeping its `now() <= start + 5 minutes` form is not redundant with the trigger: the
-- trigger only handles the early side. This is what still snaps a tap a couple of minutes *late*
-- to the scheduled start rather than letting it read as 'late'.
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

  -- Idempotent: a second tap must not shift an already-recorded time.
  INSERT INTO public.classroom_teachers_attendances (classroom_teacher_id, session_date, clocked_in_at, clocked_in_source)
  VALUES (p_classroom_teacher_id, v_session_date, v_recorded_at, 'teacher')
  ON CONFLICT ON CONSTRAINT classroom_teachers_attendances_key DO NOTHING;

  SELECT id INTO v_id
    FROM public.classroom_teachers_attendances
    WHERE classroom_teacher_id = p_classroom_teacher_id AND session_date = v_session_date;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clock_in_classroom_teacher(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- clock_out_and_continue_classroom_teacher: both sides of the handoff are recorded at the
-- scheduled boundary. See part 3 of the file header for why "lanjut" is the one place a clock-out
-- is snapped unconditionally rather than only within grace.
--
-- Authorisation and the back-to-back re-validation are copied unchanged from
-- 20260809020000_classroom_teacher_attendance_manual_continue.sql. The one structural difference:
-- because that re-validation has just proved from.time_end = to.time_start, there is a single
-- v_boundary instant serving as both the source's scheduled end and the destination's scheduled
-- start, instead of two timestamps that happen to agree.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.clock_out_and_continue_classroom_teacher(
  p_from_classroom_teacher_id uuid,
  p_to_classroom_teacher_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  SELECT t.id, c.time_end
    INTO v_teacher_id, v_from_time_end
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_from_classroom_teacher_id
      AND t.auth_user_id = auth.uid();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Not authorised for the source class';
  END IF;

  SELECT t.id, c.time_start
    INTO v_to_teacher_id, v_to_time_start
    FROM public.classroom_teachers ct
    JOIN public.teachers t ON t.id = ct.teacher_id
    JOIN public.classrooms c ON c.id = ct.classroom_id
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
$$;

GRANT EXECUTE ON FUNCTION public.clock_out_and_continue_classroom_teacher(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: the same clamp applied to rows already in the table, so this month's Total Durasi and
-- estimated payout are computed under one rule rather than changing partway through the month.
--
-- Narrow and idempotent, same shape as 20260811020000: only non-flexi rows whose clocked_in_at is
-- strictly before their scheduled start are touched, and once snapped the condition is false
-- forever after. Unlike that migration this does include admin-entered rows — see the header.
-- The effect is only ever to remove pre-start minutes, never to add any.
-- ---------------------------------------------------------------------------

UPDATE public.classroom_teachers_attendances ta
SET clocked_in_at = sub.scheduled_start,
    clocked_out_at = CASE
      WHEN ta.clocked_out_at IS NOT NULL AND ta.clocked_out_at < sub.scheduled_start THEN sub.scheduled_start
      ELSE ta.clocked_out_at
    END
FROM (
  SELECT ta2.id,
    (ta2.session_date::text || ' ' || c.time_start::text)::timestamp AT TIME ZONE 'Asia/Makassar' AS scheduled_start
  FROM public.classroom_teachers_attendances ta2
  JOIN public.classroom_teachers ct ON ct.id = ta2.classroom_teacher_id
  JOIN public.classrooms c ON c.id = ct.classroom_id
  WHERE NOT c.is_flexi_hours
) sub
WHERE ta.id = sub.id
  AND ta.clocked_in_at IS NOT NULL
  AND ta.clocked_in_at < sub.scheduled_start;
