-- Several teachers can cover one absent colleague's group on the same day, because the owner
-- distributes her children among the teachers who are left rather than handing all of them to one
-- person — the point being not to concentrate a whole class on a single teacher.
--
-- Concretely: Kelas Pagi runs three groups of four. One teacher is sick, and her four children are
-- split two and two between the other two teachers. This is not an edge case — five active classes
-- already run more than one group (Kelas Sore has five, Kelas Mengaji three).
--
-- Until now coverage was UNIQUE (classroom_teacher_id, session_date): one substitute per group per
-- day. The first teacher to press Gantikan Kelas took all four children and the second was refused
-- outright, so she could not write up the two she actually taught — and their parents saw the first
-- teacher's name on the report. That is the same wrong-attribution problem this feature exists to
-- fix, one step further along.
--
-- WHY NOT RECORD WHICH CHILDREN EACH ONE TOOK (the thorough answer, deliberately not taken yet):
-- coverage could be keyed per child, so each teacher sees only the children assigned to her. That
-- is more accurate and would answer "who taught Budi on 15 Oct" directly. It is also a much larger
-- change — the write gates would have to become per-child, and the screen would need a child
-- picker and someone to agree the split in advance. It is not needed for the parent-facing answer
-- to be correct, because children_daily_reports.submitted_by is stamped per REPORT ROW, and a
-- report row is per child. Whoever presses Kirim for a child is credited for that child, whatever
-- the coverage rows say. So the split comes out right in the only place it is read, and the
-- remaining looseness is that both covering teachers can see and edit all of the absent teacher's
-- children rather than just their own share. Worth revisiting if that looseness ever bites.
--
-- What still holds: you cannot cover your own group, cover a class whose teacher clocked in, cover
-- a class clashing with one you held that day, cover a future date, or declare twice yourself.

-- ---------------------------------------------------------------------------
-- One row per (group, substitute, date) instead of per (group, date)
-- ---------------------------------------------------------------------------

ALTER TABLE public.classroom_teachers_substitutions
  DROP CONSTRAINT IF EXISTS classroom_teachers_substitutions_group_date_key;

-- Still exactly one row per teacher per group per day, so declaring twice cannot duplicate and the
-- idempotent return below has something to key on.
ALTER TABLE public.classroom_teachers_substitutions
  ADD CONSTRAINT classroom_teachers_substitutions_group_teacher_date_key
  UNIQUE (classroom_teacher_id, substitute_teacher_id, session_date);

COMMENT ON TABLE public.classroom_teachers_substitutions IS
  'One row per teacher covering a group on one date. SEVERAL teachers may cover the same group on '
  'the same day — an absent teacher''s children are distributed among those who are left, so each '
  'of them gets a row. The source of truth for "who stood in for this group that day": it unlocks '
  'that day''s absensi and Catatan Guru for each substitute, and records whether the day is '
  'payable. Which child each one actually taught is not recorded here; children_daily_reports. '
  'submitted_by answers that per child, which is what parents are shown.';

-- ---------------------------------------------------------------------------
-- Declaring: a second substitute is no longer a takeover
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.declare_substitution(
  p_classroom_teacher_id uuid,
  p_session_date date,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    FROM public.teachers t
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

  SELECT ct.classroom_id, ct.teacher_id, c.time_start, c.time_end, c.is_flexi_hours, c.active
    INTO v_classroom_id, v_assigned_teacher_id, v_time_start, v_time_end, v_is_flexi_hours, v_active
    FROM public.classroom_teachers ct
    JOIN public.classrooms c ON c.id = ct.classroom_id
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
  IF NOT v_is_flexi_hours AND EXISTS (
    SELECT 1
    FROM public.classrooms other
    WHERE other.id <> v_classroom_id
      AND NOT other.is_flexi_hours
      AND other.time_start < v_time_end
      AND other.time_end > v_time_start
      AND EXISTS (
        SELECT 1
        FROM public.classroom_teachers ct2
        WHERE ct2.classroom_id = other.id
          AND (
            ct2.teacher_id = v_teacher_id
            OR EXISTS (
              SELECT 1
              FROM public.classroom_teachers_substitutions s2
              WHERE s2.classroom_teacher_id = ct2.id
                AND s2.session_date = p_session_date
                AND s2.substitute_teacher_id = v_teacher_id
            )
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
$$;

COMMENT ON FUNCTION public.declare_substitution(uuid, date, text) IS
  'A teacher declares that she helped cover another teacher''s group on a date. Several teachers '
  'may declare the same group and date — an absent teacher''s children are split between those who '
  'are left. Any date up to and including today; a future date is refused, because student '
  'attendance draws down a paid quota and a class nobody has taught cannot be billed. Also refuses '
  'unless she is an active teacher, the class is active, it is not her own group, the date is a '
  'weekday, the assigned teacher did not clock in that day, and it does not clash with another '
  'class she held then. The clock-in window is applied only when the date is today. Idempotent for '
  'the same substitute.';

-- ---------------------------------------------------------------------------
-- Withdrawing: only what she submitted herself can pin her
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.withdraw_substitution(
  p_classroom_teacher_id uuid,
  p_session_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  SELECT t.id INTO v_teacher_id FROM public.teachers t WHERE t.auth_user_id = auth.uid();

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
    WHERE r.classroom_teacher_id = p_classroom_teacher_id
      AND r.report_date = p_session_date
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

COMMENT ON FUNCTION public.withdraw_substitution(uuid, date) IS
  'Gives up coverage of a group on one date — the way back from picking the wrong class. A teacher '
  'withdraws only her own row, leaving any other substitute on that group untouched, and is '
  'refused once SHE has submitted a report for that date. An admin withdraws every substitute on '
  'the group that day, and is refused if any report for it has been submitted. Whatever was '
  'written stays; only the access goes.';

-- ---------------------------------------------------------------------------
-- The picker: how many others are already in, rather than "taken"
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.substitutable_classes(date);

CREATE OR REPLACE FUNCTION public.substitutable_classes(p_session_date date)
RETURNS TABLE (
  classroom_teacher_id uuid,
  classroom_id uuid,
  label text,
  time_start time,
  time_end time,
  teacher_id uuid,
  teacher_full_name text,
  teacher_call_name text,
  covered_by_me boolean,
  other_substitute_count integer,
  teacher_clocked_in boolean,
  student_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH me AS (
    SELECT t.id FROM public.teachers t WHERE t.auth_user_id = auth.uid() AND t.active
  )
  SELECT
    ct.id,
    ct.classroom_id,
    c.label,
    c.time_start,
    c.time_end,
    ct.teacher_id,
    assigned.full_name,
    assigned.call_name,
    EXISTS (
      SELECT 1 FROM public.classroom_teachers_substitutions s
      WHERE s.classroom_teacher_id = ct.id
        AND s.session_date = p_session_date
        AND s.substitute_teacher_id IN (SELECT id FROM me)
    ),
    -- A count, not a block: other teachers helping with the same group is the normal case now.
    -- Deliberately not their names — teacherDisplayName() in the client is the single place the
    -- call-name-over-full-name rule lives, and duplicating it in SQL to build a label here would
    -- give two answers to the same question.
    (
      SELECT count(*)::int FROM public.classroom_teachers_substitutions s
      WHERE s.classroom_teacher_id = ct.id
        AND s.session_date = p_session_date
        AND s.substitute_teacher_id NOT IN (SELECT id FROM me)
    ),
    EXISTS (
      SELECT 1 FROM public.classroom_teachers_attendances ta
      WHERE ta.classroom_teacher_id = ct.id
        AND ta.session_date = p_session_date
        AND ta.clocked_in_at IS NOT NULL
    ),
    (
      -- Enrolment as it stood on that date, not as it stands now: a child who has since moved
      -- group was in this one on the day being covered, and is who the teacher taught.
      SELECT count(*)::int FROM public.children_classrooms cc
      WHERE cc.classroom_teacher_id = ct.id
        AND cc.started_at <= p_session_date
        AND (cc.ended_at IS NULL OR cc.ended_at >= p_session_date)
    )
  FROM public.classroom_teachers ct
  JOIN public.classrooms c ON c.id = ct.classroom_id
  LEFT JOIN public.teachers assigned ON assigned.id = ct.teacher_id
  WHERE EXISTS (SELECT 1 FROM me)
    AND c.active
    AND c.is_billable
    AND ct.teacher_id NOT IN (SELECT id FROM me)
    AND EXISTS (
      SELECT 1 FROM public.children_classrooms cc
      WHERE cc.classroom_teacher_id = ct.id
        AND cc.started_at <= p_session_date
        AND (cc.ended_at IS NULL OR cc.ended_at >= p_session_date)
    )
  ORDER BY c.time_start, c.label, assigned.full_name;
$$;

COMMENT ON FUNCTION public.substitutable_classes(date) IS
  'Every billable, active group that is not the calling teacher''s own and had children enrolled on '
  'p_session_date, with its class, its assigned teacher and that date''s state: whether she already '
  'covers it, how many OTHER teachers are covering it too, whether its own teacher clocked in, and '
  'how many children were enrolled. Powers both dropdowns on Gantikan Kelas — a teacher cannot see '
  'other teachers'' groups or names through RLS at all. The flags are advisory for the UI; '
  'declare_substitution re-checks every rule itself.';

GRANT EXECUTE ON FUNCTION public.substitutable_classes(date) TO authenticated, service_role;
