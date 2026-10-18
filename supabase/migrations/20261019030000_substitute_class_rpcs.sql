-- What the teacher's Gantikan Kelas screen calls, plus the attribution fix that makes a
-- substitute's report honest to the parent.
--
-- All SECURITY DEFINER, and not for convenience: `teachers` has only teacher_select_own_profile and
-- classroom_teachers is restricted to her own groups, so a teacher cannot read another teacher's
-- name or class through RLS at all. The screen's two dropdowns — pick a class, then pick the
-- teacher in it whose group you are covering — are simply not expressible from the client without
-- substitutable_classes().
--
-- declare_substitution takes NO date parameter on purpose. The server uses today in WITA, so a
-- teacher cannot quietly backdate coverage to reopen a day she should no longer be writing to.
-- Backdating stays an admin action.

-- ---------------------------------------------------------------------------
-- The pay rule, in one place
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.default_counts_for_pay(
  p_classroom_teacher_id uuid,
  p_substitute_teacher_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  -- Already holds a group in the same classroom => already in that room for that hour, already
  -- paid for it, so covering a second group there earns nothing extra. Otherwise she came in from
  -- outside and is owed that classroom's rate.
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.classroom_teachers mine
    JOIN public.classroom_teachers covered ON covered.id = p_classroom_teacher_id
    WHERE mine.classroom_id = covered.classroom_id
      AND mine.teacher_id = p_substitute_teacher_id
  );
$$;

COMMENT ON FUNCTION public.default_counts_for_pay(uuid, uuid) IS
  'The owner''s rule for whether coverage is payable: false when the substitute already holds a '
  'group in the covered classroom, true otherwise. The single definition of that rule. The '
  'physically meaningful question is whether she was already being paid for that time slot, and '
  'same-classroom is its common case.';

GRANT EXECUTE ON FUNCTION public.default_counts_for_pay(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Discovery: what the two dropdowns are built from
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.substitutable_classes()
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
  covered_by_other boolean,
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
  ),
  today AS (
    SELECT (now() AT TIME ZONE 'Asia/Makassar')::date AS d
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
        AND s.session_date = (SELECT d FROM today)
        AND s.substitute_teacher_id IN (SELECT id FROM me)
    ),
    EXISTS (
      SELECT 1 FROM public.classroom_teachers_substitutions s
      WHERE s.classroom_teacher_id = ct.id
        AND s.session_date = (SELECT d FROM today)
        AND s.substitute_teacher_id NOT IN (SELECT id FROM me)
    ),
    EXISTS (
      SELECT 1 FROM public.classroom_teachers_attendances ta
      WHERE ta.classroom_teacher_id = ct.id
        AND ta.session_date = (SELECT d FROM today)
        AND ta.clocked_in_at IS NOT NULL
    ),
    (
      SELECT count(*)::int FROM public.children_classrooms cc
      WHERE cc.classroom_teacher_id = ct.id AND cc.ended_at IS NULL
    )
  FROM public.classroom_teachers ct
  JOIN public.classrooms c ON c.id = ct.classroom_id
  LEFT JOIN public.teachers assigned ON assigned.id = ct.teacher_id
  WHERE EXISTS (SELECT 1 FROM me)
    AND c.active
    -- Billable classes only: a flexi work item (Pembuatan Konten) or Piket Pagi has no students to
    -- take over, so it has no business in a "whose class am I covering" picker.
    AND c.is_billable
    -- Her own groups are not something she stands in for.
    AND ct.teacher_id NOT IN (SELECT id FROM me)
    -- A group with nobody enrolled is an empty assignment, not a class needing cover.
    AND EXISTS (
      SELECT 1 FROM public.children_classrooms cc
      WHERE cc.classroom_teacher_id = ct.id AND cc.ended_at IS NULL
    )
  ORDER BY c.time_start, c.label, assigned.full_name;
$$;

COMMENT ON FUNCTION public.substitutable_classes() IS
  'Every billable, active, non-empty group that is not the calling teacher''s own, with its class, '
  'its assigned teacher and today''s state: whether she already covers it, whether someone else '
  'does, whether its own teacher has clocked in, and how many children are enrolled. Powers both '
  'dropdowns on Gantikan Kelas — a teacher cannot see other teachers'' groups or names through RLS '
  'at all. The flags are advisory for the UI; declare_substitution re-checks every rule itself.';

GRANT EXECUTE ON FUNCTION public.substitutable_classes() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The Gantikan Kelas button
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.declare_substitution(
  p_classroom_teacher_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_session_date date;
  v_classroom_id uuid;
  v_assigned_teacher_id uuid;
  v_time_start time;
  v_time_end time;
  v_is_flexi_hours boolean;
  v_active boolean;
  v_scheduled_start timestamptz;
  v_existing_id uuid;
  v_existing_substitute uuid;
  v_id uuid;
BEGIN
  SELECT t.id INTO v_teacher_id
    FROM public.teachers t
    WHERE t.auth_user_id = auth.uid() AND t.active;
  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Hanya guru aktif yang bisa menggantikan kelas';
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

  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  -- A flexi-hours class has no schedule to judge a day or a window against — see
  -- clock_in_classroom_teacher, which skips the same two checks for the same reason.
  IF NOT v_is_flexi_hours THEN
    IF extract(isodow FROM v_session_date) > 5 THEN
      RAISE EXCEPTION 'Kelas hanya berjalan hari Senin sampai Jumat';
    END IF;

    v_scheduled_start := (v_session_date::text || ' ' || v_time_start::text)::timestamp
      AT TIME ZONE 'Asia/Makassar';

    -- Same floor as clocking in. No upper bound inside the day: filing coverage after the class
    -- has finished is normal, because she was busy teaching it.
    IF now() < v_scheduled_start - interval '60 minutes' THEN
      RAISE EXCEPTION 'Belum waktunya menggantikan kelas ini (mulai 1 jam sebelum jadwal kelas dimulai)';
    END IF;
  END IF;

  -- Idempotent for the same substitute (a second tap of Gantikan Kelas is harmless), but never a
  -- takeover.
  SELECT s.id, s.substitute_teacher_id INTO v_existing_id, v_existing_substitute
    FROM public.classroom_teachers_substitutions s
    WHERE s.classroom_teacher_id = p_classroom_teacher_id
      AND s.session_date = v_session_date;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_substitute = v_teacher_id THEN
      RETURN v_existing_id;
    END IF;
    RAISE EXCEPTION 'Kelas ini sudah digantikan guru lain hari ini';
  END IF;

  -- The assigned teacher must genuinely be absent. If she has already clocked in she is standing
  -- right there, and this is not a coverage situation.
  IF EXISTS (
    SELECT 1
    FROM public.classroom_teachers_attendances ta
    WHERE ta.classroom_teacher_id = p_classroom_teacher_id
      AND ta.session_date = v_session_date
      AND ta.clocked_in_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Guru kelas ini sudah absen masuk hari ini';
  END IF;

  -- She cannot be in two rooms at once: refuse a class whose schedule overlaps one she already
  -- holds today, as her own group or as another coverage. Flexi-hours classes have no meaningful
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
                AND s2.session_date = v_session_date
                AND s2.substitute_teacher_id = v_teacher_id
            )
          )
      )
  ) THEN
    RAISE EXCEPTION 'Jadwal kelas ini bentrok dengan kelas Anda yang lain hari ini';
  END IF;

  INSERT INTO public.classroom_teachers_substitutions (
    classroom_teacher_id, substitute_teacher_id, session_date,
    counts_for_pay, created_by_role, reason, created_by
  )
  VALUES (
    p_classroom_teacher_id, v_teacher_id, v_session_date,
    public.default_counts_for_pay(p_classroom_teacher_id, v_teacher_id),
    'teacher', NULLIF(btrim(p_reason), ''), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.declare_substitution(uuid, text) IS
  'A teacher declares that she is covering another teacher''s group TODAY (WITA — there is no date '
  'parameter, so coverage cannot be backdated). Refuses unless she is an active teacher, the class '
  'is active, it is not her own group, it is a class day within the clock-in window, nobody else '
  'already covers it, the assigned teacher has not clocked in, and it does not clash with another '
  'class she holds today. Idempotent for the same substitute.';

GRANT EXECUTE ON FUNCTION public.declare_substitution(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Withdrawing a mistake
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.withdraw_substitution(p_classroom_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id uuid;
  v_session_date date;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  v_session_date := (now() AT TIME ZONE 'Asia/Makassar')::date;

  SELECT t.id INTO v_teacher_id FROM public.teachers t WHERE t.auth_user_id = auth.uid();

  -- A teacher may undo only her own coverage, and only today's — the same day she could declare
  -- it. Without this she would have no way back from picking the wrong class in the dropdown, and
  -- there is no admin screen for substitutions yet.
  IF NOT v_is_admin AND v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Tidak diizinkan';
  END IF;

  -- Anything already written stays: withdrawing gives up access, it does not undo the work. A
  -- submitted report is the line — once a parent can see it, the author must not be able to walk
  -- away from it.
  IF EXISTS (
    SELECT 1
    FROM public.children_daily_reports r
    WHERE r.classroom_teacher_id = p_classroom_teacher_id
      AND r.report_date = v_session_date
      AND r.submitted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Laporan sudah dikirim untuk kelas ini hari ini, jadi penggantian tidak bisa dibatalkan';
  END IF;

  DELETE FROM public.classroom_teachers_substitutions s
  WHERE s.classroom_teacher_id = p_classroom_teacher_id
    AND s.session_date = v_session_date
    AND (v_is_admin OR s.substitute_teacher_id = v_teacher_id);
END;
$$;

COMMENT ON FUNCTION public.withdraw_substitution(uuid) IS
  'Gives up today''s coverage of a group — the way back from picking the wrong class. A teacher can '
  'only withdraw her own, and only today''s; an admin can withdraw any of today''s. Refused once a '
  'report for that day has been submitted, because a parent can already see it. Whatever was '
  'written stays; only the access goes.';

GRANT EXECUTE ON FUNCTION public.withdraw_substitution(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Attribution: the parent sees who actually taught
--
-- daily_report_for_attendance has always resolved the author through classroom_teachers ->
-- teachers, i.e. the group's ASSIGNED teacher (20261002010000). That was correct while only the
-- assigned teacher could write a report. Now that a substitute can, the same join would show a
-- parent their regular teacher's name over a note she did not write — dishonest to the parent, and
-- unfair to the teacher being credited.
--
-- WHY NOT created_by (the obvious candidate, rejected):
-- created_by is only ever written in the INSERT arm of the three save RPCs; every
-- ON CONFLICT DO UPDATE arm leaves it untouched (20261001020000:84-92 and :141-144). So if the
-- assigned teacher saved a mood draft at 08:10 and then went home ill, the substitute's note lands
-- on a row whose created_by is the absent teacher, and the parent sees exactly the wrong name
-- again. save_daily_report_mood and save_daily_report_items also create rows carrying no note at
-- all, so created_by routinely names someone who wrote nothing.
--
-- So: a new submitted_by, stamped by submit_daily_report beside submitted_at. Parents only ever see
-- submitted reports (parent_select_submitted_children_daily_reports), so "who sent it" is exactly
-- the question worth answering, and submitting is a single write site that cannot drift the way an
-- upsert's INSERT arm does. submit_daily_report's existing early return for an already-submitted
-- report is kept, so a second Kirim cannot rewrite the author.
--
-- created_by stays as it is, as the audit trail of who opened the row.
-- ---------------------------------------------------------------------------

ALTER TABLE public.children_daily_reports
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.children_daily_reports.submitted_by IS
  'Who pressed Kirim — the honest author of what a parent reads, which is not necessarily the '
  'group''s assigned teacher once a substitute can fill the report. Stamped by submit_daily_report '
  'and never rewritten by a later submit. NULL for reports submitted before this column existed, '
  'and for an admin submission by someone with no teachers row; daily_report_for_attendance falls '
  'back to created_by and then to the assigned teacher.';

-- Body otherwise identical to the version in 20261019020000.
CREATE OR REPLACE FUNCTION public.submit_daily_report(p_report_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_teacher_id uuid;
  v_report_date date;
  v_submitted_at timestamptz;
BEGIN
  SELECT classroom_teacher_id, report_date, submitted_at
    INTO v_classroom_teacher_id, v_report_date, v_submitted_at
    FROM public.children_daily_reports
    WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  IF NOT public.can_write_daily_report(v_classroom_teacher_id, v_report_date) THEN
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

-- Signature and returned columns are unchanged, so src/types/database.ts,
-- fetchDailyReportForAttendance and teacherDisplayName() all keep working untouched — only *which*
-- teacher the two name columns describe changes.
--
-- The author is picked in a LATERAL with an explicit priority, not with two independent COALESCEs
-- over separate joins: COALESCE(ts.full_name, tc.full_name, ta.full_name) paired with
-- COALESCE(ts.call_name, tc.call_name, ta.call_name) can take the full name from one teacher and
-- the call name from another whenever one of them has a NULL call_name, and print "Bu Rina" beside
-- the wrong formal name. Taking one row keeps the pair consistent.
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
  teacher_call_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    r.id,
    r.submitted_at,
    r.mood_arrival,
    r.mood_studying,
    r.mood_departure,
    r.teacher_note,
    author.full_name,
    author.call_name
  FROM public.children_daily_reports r
  JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
  -- LEFT: a deleted teacher must not take the report down with them.
  LEFT JOIN LATERAL (
    SELECT candidate.full_name, candidate.call_name
    FROM (
      SELECT 1 AS prio, ts.full_name, ts.call_name
        FROM public.teachers ts WHERE ts.auth_user_id = r.submitted_by
      UNION ALL
      SELECT 2 AS prio, tc.full_name, tc.call_name
        FROM public.teachers tc WHERE tc.auth_user_id = r.created_by
      UNION ALL
      SELECT 3 AS prio, ta.full_name, ta.call_name
        FROM public.teachers ta WHERE ta.id = ct.teacher_id
    ) candidate
    ORDER BY candidate.prio
    LIMIT 1
  ) author ON true
  WHERE r.child_id = p_child_id
    AND ct.classroom_id = p_classroom_id
    AND r.report_date = p_report_date
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
  -- At most one row in practice (one report per child per group per day). Ordered and capped
  -- anyway so a child moved between two groups of the same classroom mid-day cannot make the
  -- caller choose arbitrarily — the sent one wins over a draft.
  ORDER BY r.submitted_at DESC NULLS LAST, r.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.daily_report_for_attendance(uuid, uuid, date) IS
  'The daily report belonging to one attendance day (child + classroom + date), joined through '
  'classroom_teachers. SECURITY DEFINER with its own access clause mirroring '
  'children_daily_reports'' RLS: admin sees all, a teacher their own groups, a substitute the day '
  'she covered, a parent their own children and only once submitted. Exists because a parent '
  'cannot read either side of that join — classroom_teachers only while the enrolment is current, '
  'teachers not at all. The two name columns describe whoever actually sent the report '
  '(submitted_by, then created_by, then the group''s assigned teacher), not the assigned teacher, '
  'so a substitute''s note is credited to her.';

GRANT EXECUTE ON FUNCTION public.daily_report_for_attendance(uuid, uuid, date) TO authenticated, service_role;
