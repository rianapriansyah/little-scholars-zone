-- Laporan Harian is being reworked around mood and a free-text teacher note instead of the
-- per-materi mastery sheet (the teacher UI hides Materi Hari Ini and the parent preview for now
-- — see DAILY_REPORT_MATERI_ENABLED in featureFlags.ts). Two schema changes go with that:
--
--   1. daily_reports → children_daily_reports, so the name says whose report it is.
--   2. A teacher_note column: the teacher's free-text note on the child's day.
--
-- The rename. ALTER TABLE ... RENAME carries everything bound to the table by OID — RLS policies,
-- indexes, constraints, the daily_report_items FK, any views — so those keep working untouched.
-- What it does NOT carry is function bodies: plpgsql and plain-SQL functions store their source
-- as text and resolve `public.daily_reports` by name at call time, so every one of them would
-- start failing with "relation does not exist" the moment the rename commits. All six that
-- reference the table on the live database (checked with prosrc ILIKE '%daily_report%', which is
-- also how save_daily_report_mood — applied through the connector, with no file in this repo —
-- was found) are recreated below in the same transaction. Two of them also name the
-- daily_reports_child_date_key constraint in ON CONFLICT ON CONSTRAINT, which the constraint
-- rename below would otherwise break just the same.
--
-- The constraints, indexes and policies are renamed too, purely so the next person reading
-- \d children_daily_reports doesn't see a table apparently named something else.
--
-- daily_report_items is deliberately not renamed — it wasn't asked for, and it is about to be
-- dormant while materi is hidden.

ALTER TABLE public.daily_reports RENAME TO children_daily_reports;

ALTER TABLE public.children_daily_reports RENAME CONSTRAINT daily_reports_pkey TO children_daily_reports_pkey;
ALTER TABLE public.children_daily_reports RENAME CONSTRAINT daily_reports_child_date_key TO children_daily_reports_child_date_key;
ALTER TABLE public.children_daily_reports RENAME CONSTRAINT daily_reports_child_id_fkey TO children_daily_reports_child_id_fkey;
ALTER TABLE public.children_daily_reports RENAME CONSTRAINT daily_reports_classroom_teacher_id_fkey TO children_daily_reports_classroom_teacher_id_fkey;
ALTER TABLE public.children_daily_reports RENAME CONSTRAINT daily_reports_created_by_fkey TO children_daily_reports_created_by_fkey;
ALTER TABLE public.children_daily_reports RENAME CONSTRAINT daily_reports_mood_arrival_check TO children_daily_reports_mood_arrival_check;
ALTER TABLE public.children_daily_reports RENAME CONSTRAINT daily_reports_mood_studying_check TO children_daily_reports_mood_studying_check;
ALTER TABLE public.children_daily_reports RENAME CONSTRAINT daily_reports_mood_departure_check TO children_daily_reports_mood_departure_check;

ALTER INDEX public.daily_reports_classroom_teacher_date_idx RENAME TO children_daily_reports_classroom_teacher_date_idx;
ALTER INDEX public.daily_reports_child_id_idx RENAME TO children_daily_reports_child_id_idx;

ALTER POLICY admin_all_daily_reports ON public.children_daily_reports
  RENAME TO admin_all_children_daily_reports;
ALTER POLICY teacher_select_own_daily_reports ON public.children_daily_reports
  RENAME TO teacher_select_own_children_daily_reports;
ALTER POLICY teacher_insert_own_daily_reports ON public.children_daily_reports
  RENAME TO teacher_insert_own_children_daily_reports;
ALTER POLICY teacher_update_own_daily_reports ON public.children_daily_reports
  RENAME TO teacher_update_own_children_daily_reports;
ALTER POLICY parent_select_submitted_daily_reports ON public.children_daily_reports
  RENAME TO parent_select_submitted_children_daily_reports;

ALTER TABLE public.children_daily_reports ADD COLUMN teacher_note text;

COMMENT ON COLUMN public.children_daily_reports.teacher_note IS
  'The teacher''s free-text note on the child''s day. Like every other column on this table it '
  'becomes visible to the parent once submitted_at is stamped (parent_select_submitted_children_'
  'daily_reports is row-level, not column-level). Distinct from mood_note / mood_note_parent, '
  'which are specifically about mood and are not shown in the current teacher UI.';

-- ---------------------------------------------------------------------------
-- Functions: recreated verbatim from their live definitions, with only the table name (and, for
-- the two upserts, the ON CONFLICT constraint name) changed — except save_daily_report_mood,
-- which also gains p_teacher_note.
-- ---------------------------------------------------------------------------

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

  -- daily_report_items cascades from children_daily_reports on its own (ON DELETE CASCADE).
  DELETE FROM public.classroom_teachers_attendances WHERE classroom_teacher_id = p_classroom_teacher_id;
  DELETE FROM public.children_daily_reports WHERE classroom_teacher_id = p_classroom_teacher_id;
  DELETE FROM public.children_classrooms WHERE classroom_teacher_id = p_classroom_teacher_id;

  DELETE FROM public.classroom_teachers WHERE id = p_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.family_submitted_daily_report_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dr.id
  FROM public.children_daily_reports dr
  JOIN public.children c ON c.id = dr.child_id
  JOIN public.families f ON f.id = c.family_id
  WHERE dr.submitted_at IS NOT NULL
    AND f.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.teacher_daily_report_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dr.id
  FROM public.children_daily_reports dr
  JOIN public.classroom_teachers ct ON ct.id = dr.classroom_teacher_id
  JOIN public.teachers t ON t.id = ct.teacher_id
  WHERE t.auth_user_id = p_auth_uid;
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
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id) THEN
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

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_id = p_child_id AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  INSERT INTO public.children_daily_reports (child_id, classroom_teacher_id, report_date, created_by)
  VALUES (p_child_id, p_classroom_teacher_id, p_report_date, auth.uid())
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_date_key
  DO UPDATE SET classroom_teacher_id = EXCLUDED.classroom_teacher_id
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
  v_classroom_teacher_id uuid;
  v_submitted_at timestamptz;
BEGIN
  SELECT classroom_teacher_id, submitted_at
    INTO v_classroom_teacher_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  IF NOT public.can_write_daily_report(v_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Not authorised to submit reports for this class';
  END IF;

  IF v_submitted_at IS NOT NULL THEN
    RETURN v_submitted_at;
  END IF;

  UPDATE public.children_daily_reports
    SET submitted_at = now()
    WHERE id = p_report_id
    RETURNING submitted_at INTO v_submitted_at;

  RETURN v_submitted_at;
END;
$$;

-- save_daily_report_mood gains a parameter, and CREATE OR REPLACE with a different argument list
-- would add an overload rather than replace — leaving the old 8-argument version behind, still
-- pointing at the old table name. Drop it explicitly first.
--
-- p_teacher_note is appended last with a DEFAULT, so any caller using named arguments (PostgREST
-- always does) keeps working. Note the upsert writes every field it is given, NULL included —
-- it is "save this whole mood panel", not a patch — so a caller must pass back the values it
-- loaded for fields it doesn't edit. saveDailyReportMood in src/lib/dailyReport.ts does.
DROP FUNCTION IF EXISTS public.save_daily_report_mood(uuid, uuid, date, text, text, text, text, text);

CREATE FUNCTION public.save_daily_report_mood(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_mood_arrival text DEFAULT NULL,
  p_mood_studying text DEFAULT NULL,
  p_mood_departure text DEFAULT NULL,
  p_mood_note text DEFAULT NULL,
  p_mood_note_parent text DEFAULT NULL,
  p_teacher_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id) THEN
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

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_id = p_child_id AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  INSERT INTO public.children_daily_reports (
    child_id, classroom_teacher_id, report_date, created_by,
    mood_arrival, mood_studying, mood_departure, mood_note, mood_note_parent, teacher_note
  )
  VALUES (
    p_child_id, p_classroom_teacher_id, p_report_date, auth.uid(),
    p_mood_arrival, p_mood_studying, p_mood_departure, p_mood_note, p_mood_note_parent, p_teacher_note
  )
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_date_key
  DO UPDATE SET
    classroom_teacher_id = EXCLUDED.classroom_teacher_id,
    mood_arrival = EXCLUDED.mood_arrival,
    mood_studying = EXCLUDED.mood_studying,
    mood_departure = EXCLUDED.mood_departure,
    mood_note = EXCLUDED.mood_note,
    mood_note_parent = EXCLUDED.mood_note_parent,
    teacher_note = EXCLUDED.teacher_note
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_daily_report_mood(uuid, uuid, date, text, text, text, text, text, text)
  TO authenticated, service_role;
