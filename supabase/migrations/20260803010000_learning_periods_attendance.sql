-- Learning periods + child attendance.
--
-- A parent buys a learning period: a guaranteed block of 20 effective attendance days.
-- Families enrol mid-month, which is exactly why the quota is a day count and not a calendar
-- month — there is no proration anywhere in here.
--
-- A day is consumed when an attendance row exists with status 'present' or 'absent'. 'sick'
-- does not consume. Public holidays and force majeure are represented by the ABSENCE of an
-- attendance row for that date, so they consume nothing by construction; that is why there
-- is no holiday calendar, no absence policy table and no extra status.
--
-- Payment is deliberately out of scope: no amount, status or payment columns live here. When
-- payments land they add one term to learning_period_status.is_active and nothing downstream
-- needs to change.

CREATE TABLE public.learning_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.children(id),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id),
  period_no smallint NOT NULL,

  start_date date NOT NULL,
  projected_end_date date,
  actual_end_date date,

  guaranteed_days smallint NOT NULL DEFAULT 20,

  closed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT learning_periods_child_classroom_period_no_key UNIQUE (child_id, classroom_id, period_no),
  -- Not redundant with the PK: a UNIQUE on exactly these three columns is what lets
  -- child_attendances carry a composite FK (see below).
  CONSTRAINT learning_periods_id_child_classroom_key UNIQUE (id, child_id, classroom_id)
);

COMMENT ON TABLE public.learning_periods IS
  'A purchased block of guaranteed attendance days for one child in one classroom. '
  'Periods are created by an admin only; nothing auto-creates the next one.';

-- The one place this feature deliberately diverges from the rest of the schema.
COMMENT ON COLUMN public.learning_periods.classroom_id IS
  'Deliberately classroom_id, NOT classroom_teacher_id (which is what children_classrooms '
  'and daily_reports key off). The billed program is the classroom, so moving a child to a '
  'different teacher within the same classroom must not reset or orphan their 20-day quota. '
  'Do not "fix" this to classroom_teacher_id.';

COMMENT ON COLUMN public.learning_periods.period_no IS
  'Sequential per (child, classroom): 1, 2, 3... Assigned by the admin screen as max + 1.';

COMMENT ON COLUMN public.learning_periods.projected_end_date IS
  'Rough estimate shown to parents only. Never used in any calculation.';

COMMENT ON COLUMN public.learning_periods.actual_end_date IS
  'Stamped by record_attendance() with the date whose attendance consumed the final '
  'guaranteed day. NULL while the period is still running.';

COMMENT ON COLUMN public.learning_periods.closed_at IS
  'Set when the quota is exhausted. Closing is one-way: record_attendance() never reopens a '
  'period, even if a later correction drops days_consumed back below guaranteed_days.';

COMMENT ON COLUMN public.learning_periods.guaranteed_days IS
  'Days the parent paid for. Defaults to 20; a column rather than a constant so a one-off '
  'promotional block can differ without a migration.';

CREATE TABLE public.child_attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_period_id uuid NOT NULL,
  child_id uuid NOT NULL,
  classroom_id uuid NOT NULL,
  attendance_date date NOT NULL,

  status text NOT NULL CHECK (status IN ('present', 'absent', 'sick')),
  note text,

  recorded_by uuid REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),

  -- classroom_id is part of the key on purpose: without it a child enrolled in two
  -- separately-billed classrooms could only ever have one attendance row per day.
  CONSTRAINT child_attendances_child_classroom_date_key UNIQUE (child_id, classroom_id, attendance_date),
  -- Three-column FK, not a plain reference to learning_periods(id): it makes it impossible to
  -- file an attendance row against a period belonging to a different child or classroom,
  -- which would silently drain the wrong quota.
  CONSTRAINT child_attendances_period_fkey FOREIGN KEY (learning_period_id, child_id, classroom_id)
    REFERENCES public.learning_periods (id, child_id, classroom_id)
);

COMMENT ON TABLE public.child_attendances IS
  'One row per child per classroom per date. No row at all means the class did not run that '
  'day (public holiday, force majeure) and nothing is consumed.';

COMMENT ON COLUMN public.child_attendances.child_id IS
  'Redundant with learning_period_id by design — required for the unique key and the '
  'composite FK. Do not normalise away.';

COMMENT ON COLUMN public.child_attendances.classroom_id IS
  'Redundant with learning_period_id by design — required for the unique key and the '
  'composite FK. Do not normalise away.';

COMMENT ON COLUMN public.child_attendances.status IS
  '''present'' and ''absent'' each consume one guaranteed day; ''sick'' consumes nothing.';

COMMENT ON COLUMN public.child_attendances.note IS
  'Descriptive only. Never affects the quota.';

CREATE INDEX child_attendances_learning_period_id_idx
  ON public.child_attendances (learning_period_id);

-- Supports the open-period lookup record_attendance() does on every call. Intentionally NOT
-- unique: more than one open period per (child, classroom) is legal, and the RPC breaks the
-- tie by lowest period_no.
CREATE INDEX learning_periods_open_idx
  ON public.learning_periods (child_id, classroom_id) WHERE closed_at IS NULL;

GRANT ALL ON public.learning_periods TO authenticated, service_role;
GRANT ALL ON public.child_attendances TO authenticated, service_role;

ALTER TABLE public.learning_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.child_attendances ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Derived values: computed in the view, never stored. A counter column would drift from the
-- rows it counts.
-- ---------------------------------------------------------------------------

CREATE VIEW public.learning_period_status
WITH (security_invoker = true) AS
SELECT
  lp.*,
  count(ca.id) FILTER (WHERE ca.status <> 'sick')      AS days_consumed,
  count(ca.id) FILTER (WHERE ca.status = 'sick')       AS days_sick,
  lp.guaranteed_days
    - count(ca.id) FILTER (WHERE ca.status <> 'sick')  AS days_remaining,
  (lp.closed_at IS NULL
     AND lp.guaranteed_days
         > count(ca.id) FILTER (WHERE ca.status <> 'sick')) AS is_active
FROM public.learning_periods lp
LEFT JOIN public.child_attendances ca ON ca.learning_period_id = lp.id
GROUP BY lp.id;

COMMENT ON VIEW public.learning_period_status IS
  'The whole quota computation, in one place. security_invoker so the policies on '
  'learning_periods and child_attendances apply to readers of the view — without it the view '
  'would run as its owner and leak every family''s periods. When payments arrive, is_active '
  'gains one more term here and nothing downstream changes.';

GRANT SELECT ON public.learning_period_status TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- teacher_classroom_ids / family_children_ids are the existing SECURITY DEFINER helpers from
-- 20260701120300_fix_rls_recursion.sql and 20260726030000_classroom_multi_teacher.sql.

CREATE POLICY admin_all_learning_periods ON public.learning_periods FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Teachers read periods so the attendance screen can show days_remaining inline, but periods
-- are sold rather than taught — only an admin creates or edits one.
CREATE POLICY teacher_select_learning_periods ON public.learning_periods FOR SELECT
  USING (classroom_id IN (SELECT public.teacher_classroom_ids(auth.uid())));

CREATE POLICY parent_select_own_learning_periods ON public.learning_periods FOR SELECT
  USING (child_id IN (SELECT public.family_children_ids(auth.uid())));

CREATE POLICY admin_all_child_attendances ON public.child_attendances FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Scoped by classroom, not by classroom_teacher: a teacher records attendance for the
-- children in a classroom they teach. No DELETE — a mistake is corrected by re-recording.
CREATE POLICY teacher_select_child_attendances ON public.child_attendances FOR SELECT
  USING (classroom_id IN (SELECT public.teacher_classroom_ids(auth.uid())));

CREATE POLICY teacher_insert_child_attendances ON public.child_attendances FOR INSERT
  WITH CHECK (classroom_id IN (SELECT public.teacher_classroom_ids(auth.uid())));

CREATE POLICY teacher_update_child_attendances ON public.child_attendances FOR UPDATE
  USING (classroom_id IN (SELECT public.teacher_classroom_ids(auth.uid())))
  WITH CHECK (classroom_id IN (SELECT public.teacher_classroom_ids(auth.uid())));

CREATE POLICY parent_select_own_child_attendances ON public.child_attendances FOR SELECT
  USING (child_id IN (SELECT public.family_children_ids(auth.uid())));

-- ---------------------------------------------------------------------------
-- Write path
-- ---------------------------------------------------------------------------

-- True when the caller may record attendance for this classroom: an admin, or any teacher
-- assigned to it. Used by record_attendance(), which is SECURITY DEFINER and so bypasses the
-- policies above.
CREATE OR REPLACE FUNCTION public.can_record_attendance(p_classroom_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      OR EXISTS (
        SELECT 1
        FROM public.classroom_teachers ct
        JOIN public.teachers t ON t.id = ct.teacher_id
        WHERE ct.classroom_id = p_classroom_id
          AND t.auth_user_id = auth.uid()
      );
$$;

GRANT EXECUTE ON FUNCTION public.can_record_attendance(uuid) TO authenticated, service_role;

-- Records or corrects one child's attendance for one date, and closes the period when the
-- final guaranteed day is used. Idempotent: re-submitting the same date updates the existing
-- row instead of consuming a second day. Returns the attendance row id.
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
  IF NOT public.can_record_attendance(p_classroom_id) THEN
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

GRANT EXECUTE ON FUNCTION public.record_attendance(uuid, uuid, date, text, text) TO authenticated, service_role;
