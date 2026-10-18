-- Guru pengganti: when a teacher is absent, another teacher takes her group for the day and must
-- be able to fill that group's absensi and Catatan Guru (owner request). Until now she could not,
-- and the only ways round it were an admin filling it in for her, or permanently reassigning the
-- group — which silently rewrites history, because classroom_teachers_attendances,
-- children_classrooms and children_daily_reports all point at the group id, not the teacher.
--
-- One row = one group covered on one date. Not a date range: an absence is filed per session here
-- (a teacher out for three days gets three rows), which keeps "who taught this group on this day"
-- a single lookup with no overlap resolution, and makes cancelling one day trivial. If multi-day
-- leave becomes common, a range belongs in a separate "teacher_absences" concept that *generates*
-- these rows, not in this table.
--
-- Keyed on classroom_teacher_id (the group), not classroom_id, because children enrol into a group
-- (children_classrooms.classroom_teacher_id) and the daily report is group-keyed. A classroom can
-- hold several teachers, each with their own ≤6 children, so covering "the classroom" would be the
-- wrong unit entirely.
--
-- counts_for_pay is STORED, not derived, and has NO DEFAULT:
--   * it is money, so it must be auditable and overridable, and must not silently change later
--     when a teacher's classroom assignments change;
--   * no default means no insert path can decide money by omission — every caller states it.
--   The default *value* comes from default_counts_for_pay() in 20261018030000, which encodes the
--   owner's rule: a teacher already holding a group in the same classroom is already in that room
--   for that hour and already paid, so covering earns her nothing extra; a teacher coming in from
--   outside is paid at that classroom's rate. The physically meaningful test is time-slot overlap
--   (she cannot be in two rooms at once) and same-classroom is just its common case; the cheaper
--   classroom-identity test is what we store, with admin override for the rest.
--
-- WHY THE THREE EXISTING RLS HELPERS ARE NOT WIDENED (the obvious approach, rejected):
-- teacher_classroom_ids / teacher_classroom_teacher_ids / teacher_enrolled_child_ids feed 14
-- teacher policies, and UNIONing substituted groups into them looks like a one-line fix. It is a
-- hole:
--   1. Four of those policies are INSERT/UPDATE, not SELECT — teacher_insert/update_child_attendances
--      (20260803010000) and teacher_insert/update_own_children_daily_reports (20260802010000,
--      renamed 20260930010000). Widening would hand a substitute a direct PostgREST write path into
--      children_daily_reports that bypasses can_write_daily_report altogether — and with it the
--      enrolment check, the submitted-lock and the date scoping that 20261018020000 adds. The gate
--      and the hole would ship in the same change.
--   2. The helpers take no date, so one day of coverage would become a permanent grant: the absent
--      teacher's entire clock-in/late/early history and every past and future report of that group.
--   3. It would not even work. teacher_select_own_classroom_teachers (20260726030000:27) does not
--      use a helper — it inlines teacher_id = (SELECT id FROM teachers WHERE auth_user_id =
--      auth.uid()) — so the substitute still could not read the group row her dropdown needs.
-- So the three helpers and all 14 policies are left byte-identical, and coverage is granted by NEW,
-- SELECT-ONLY policies that correlate on each row's own date where the row has one. RLS policies
-- are OR'd, so adding one can only ever grant, never revoke: nothing changes for a teacher who is
-- not covering anyone. Every write path stays a SECURITY DEFINER RPC, which bypasses RLS anyway —
-- so reads are all a substitute ever needs from RLS.
--
-- child_attendances and children_daily_reports carry money and child content, and both have a date
-- column, so they get exact per-date scoping. The other five (classroom_teachers, classrooms,
-- children, children_classrooms, learning_periods) have no date to correlate on; the grant there is
-- unbounded in time and deliberately so — they are roster and programme facts about children she
-- has genuinely taught, and she needs them to read back her own work. classroom_teachers_attendances
-- gets no substitute policy at all here: that is payroll, and it is phase 2.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

CREATE TABLE public.classroom_teachers_substitutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_teacher_id uuid NOT NULL REFERENCES public.classroom_teachers(id) ON DELETE CASCADE,
  -- No ON DELETE action on purpose: deleting a teacher must not erase the record of who was paid
  -- for a class. RESTRICT (the default) makes that attempt fail loudly.
  substitute_teacher_id uuid NOT NULL REFERENCES public.teachers(id),
  session_date date NOT NULL,
  counts_for_pay boolean NOT NULL,
  created_by_role text NOT NULL
    CONSTRAINT classroom_teachers_substitutions_created_by_role_valid
    CHECK (created_by_role IN ('admin', 'teacher')),
  reason text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classroom_teachers_substitutions_group_date_key UNIQUE (classroom_teacher_id, session_date)
);

COMMENT ON TABLE public.classroom_teachers_substitutions IS
  'One row per group covered by a substitute teacher on one date. The source of truth for "who '
  'actually taught this group that day" — it unlocks that day''s absensi and Catatan Guru for the '
  'substitute, names the author shown to parents, and records whether the day is payable. Does not '
  'move the enrolment: children_classrooms, the daily report and the clock-in row all stay keyed '
  'to the covered group, so history is never rewritten.';

COMMENT ON COLUMN public.classroom_teachers_substitutions.classroom_teacher_id IS
  'The group being covered — the absent teacher''s (classroom, teacher) pair, not the classroom. '
  'Cascades on delete so delete_classroom_teacher_assignment cleans these up with the group.';

COMMENT ON COLUMN public.classroom_teachers_substitutions.session_date IS
  'The single date covered. One row per day by design — see this migration''s header for why there '
  'is no date range.';

COMMENT ON COLUMN public.classroom_teachers_substitutions.counts_for_pay IS
  'Whether this coverage earns the substitute the covered classroom''s teacher_rate. false when she '
  'already holds a group in the same classroom (already in that room, that hour, already paid); '
  'true when she came in from outside. NOT NULL with no default so no caller can decide money by '
  'omission; set from default_counts_for_pay() and overridable by an admin.';

COMMENT ON COLUMN public.classroom_teachers_substitutions.created_by_role IS
  'Whether an admin assigned this coverage or the substitute declared it herself, so a '
  'self-declared record is visible as such on Kehadiran Guru. Mirrors the clocked_in_source '
  'convention on classroom_teachers_attendances.';

-- Every predicate and set helper below looks up "what is this teacher covering", so that is the
-- index. The second one serves the admin's per-date Guru Pengganti list.
CREATE INDEX classroom_teachers_substitutions_substitute_date_idx
  ON public.classroom_teachers_substitutions (substitute_teacher_id, session_date);
CREATE INDEX classroom_teachers_substitutions_session_date_idx
  ON public.classroom_teachers_substitutions (session_date);

-- Every helper here (and the three pre-existing ones) joins teachers on auth_user_id, and the
-- per-row predicates below do it once per scanned row. There was no index on it.
CREATE INDEX IF NOT EXISTS teachers_auth_user_id_idx ON public.teachers (auth_user_id);

-- ---------------------------------------------------------------------------
-- Nobody substitutes for themselves. Needs a lookup into classroom_teachers, so it cannot be a
-- CHECK constraint.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reject_self_substitution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.substitute_teacher_id = (
    SELECT ct.teacher_id FROM public.classroom_teachers ct WHERE ct.id = NEW.classroom_teacher_id
  ) THEN
    RAISE EXCEPTION 'A teacher cannot be her own substitute for this group';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.reject_self_substitution() IS
  'Refuses a substitution whose substitute is the covered group''s own teacher. Enforced as a '
  'trigger because a CHECK constraint cannot read classroom_teachers.';

DROP TRIGGER IF EXISTS reject_self_substitution ON public.classroom_teachers_substitutions;

CREATE TRIGGER reject_self_substitution
  BEFORE INSERT OR UPDATE ON public.classroom_teachers_substitutions
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_self_substitution();

-- ---------------------------------------------------------------------------
-- Predicates and set helpers. Same shape and modifiers as the existing teacher_* helpers in
-- 20260726030000_classroom_multi_teacher.sql, so the next reader pattern-matches them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_substitute_for(p_classroom_teacher_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classroom_teachers_substitutions s
    JOIN public.teachers t ON t.id = s.substitute_teacher_id
    WHERE s.classroom_teacher_id = p_classroom_teacher_id
      AND s.session_date = p_date
      AND t.auth_user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_substitute_for(uuid, date) IS
  'True when the caller is the substitute covering this exact group on this exact date. The '
  'group-scoped half of substitute authorisation — used by can_write_daily_report and by the '
  'date-correlated SELECT policy on children_daily_reports.';

CREATE OR REPLACE FUNCTION public.is_substitute_for_classroom(p_classroom_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.classroom_teachers_substitutions s
    JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
    JOIN public.teachers t ON t.id = s.substitute_teacher_id
    WHERE ct.classroom_id = p_classroom_id
      AND s.session_date = p_date
      AND t.auth_user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_substitute_for_classroom(uuid, date) IS
  'True when the caller covers any group in this classroom on this date. The classroom-scoped half '
  'of substitute authorisation, matching can_record_attendance''s own classroom scope — attendance '
  'is keyed (child, classroom, date), not by group.';

CREATE OR REPLACE FUNCTION public.substituted_classroom_teacher_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT s.classroom_teacher_id
  FROM public.classroom_teachers_substitutions s
  JOIN public.teachers t ON t.id = s.substitute_teacher_id
  WHERE t.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.substituted_classroom_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ct.classroom_id
  FROM public.classroom_teachers_substitutions s
  JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
  JOIN public.teachers t ON t.id = s.substitute_teacher_id
  WHERE t.auth_user_id = p_auth_uid;
$$;

-- Children she has covered at any point, for the children/children_classrooms read policies. Not
-- filtered on ended_at IS NULL, unlike teacher_enrolled_child_ids: a child who has since left the
-- group was still hers on the day she taught them, and she must be able to read back that report.
CREATE OR REPLACE FUNCTION public.substituted_child_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT cc.child_id
  FROM public.classroom_teachers_substitutions s
  JOIN public.children_classrooms cc ON cc.classroom_teacher_id = s.classroom_teacher_id
  JOIN public.teachers t ON t.id = s.substitute_teacher_id
  WHERE t.auth_user_id = p_auth_uid
    AND cc.started_at <= s.session_date
    AND (cc.ended_at IS NULL OR cc.ended_at >= s.session_date);
$$;

COMMENT ON FUNCTION public.substituted_child_ids(uuid) IS
  'Children enrolled in a group the caller covered, on the date she covered it. Unlike '
  'teacher_enrolled_child_ids this is not restricted to current enrolments — a child who has since '
  'moved group was still hers on that day.';

GRANT EXECUTE ON FUNCTION public.is_substitute_for(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_substitute_for_classroom(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.substituted_classroom_teacher_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.substituted_classroom_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.substituted_child_ids(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS on the new table. Creation is RPC-only — no teacher INSERT/UPDATE/DELETE policy — for the
-- same reason classroom_teachers_attendances has none: the rules (today only, assigned teacher
-- genuinely absent, no takeover, no overlapping class) have to be enforced somewhere the client
-- cannot skip.
-- ---------------------------------------------------------------------------

GRANT ALL ON public.classroom_teachers_substitutions TO authenticated, service_role;
ALTER TABLE public.classroom_teachers_substitutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_classroom_teachers_substitutions ON public.classroom_teachers_substitutions FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY teacher_select_own_substitutions ON public.classroom_teachers_substitutions FOR SELECT
  USING (substitute_teacher_id = (SELECT id FROM public.teachers WHERE auth_user_id = auth.uid()));

-- The other side of it: a teacher who was away can see who covered her group.
CREATE POLICY teacher_select_substitutions_of_own_groups ON public.classroom_teachers_substitutions FOR SELECT
  USING (classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

-- ---------------------------------------------------------------------------
-- The substitute's read access. SELECT only, and correlated on the row's own date wherever the row
-- carries one. Named *_substituted_* throughout to keep them visibly distinct from the
-- *_own_* policies they sit beside.
-- ---------------------------------------------------------------------------

-- Dated: exactly the attendance days she covered.
DROP POLICY IF EXISTS teacher_select_substituted_child_attendances ON public.child_attendances;
CREATE POLICY teacher_select_substituted_child_attendances ON public.child_attendances FOR SELECT
  USING (public.is_substitute_for_classroom(classroom_id, attendance_date));

-- Dated: exactly the reports she is responsible for.
DROP POLICY IF EXISTS teacher_select_substituted_daily_reports ON public.children_daily_reports;
CREATE POLICY teacher_select_substituted_daily_reports ON public.children_daily_reports FOR SELECT
  USING (public.is_substitute_for(classroom_teacher_id, report_date));

-- Undated from here down: roster and programme facts, needed to build the class dropdown and the
-- roster at all. See the header.
DROP POLICY IF EXISTS teacher_select_substituted_classroom_teachers ON public.classroom_teachers;
CREATE POLICY teacher_select_substituted_classroom_teachers ON public.classroom_teachers FOR SELECT
  USING (id IN (SELECT public.substituted_classroom_teacher_ids(auth.uid())));

DROP POLICY IF EXISTS teacher_select_substituted_classrooms ON public.classrooms;
CREATE POLICY teacher_select_substituted_classrooms ON public.classrooms FOR SELECT
  USING (id IN (SELECT public.substituted_classroom_ids(auth.uid())));

DROP POLICY IF EXISTS teacher_select_substituted_children_classrooms ON public.children_classrooms;
CREATE POLICY teacher_select_substituted_children_classrooms ON public.children_classrooms FOR SELECT
  USING (classroom_teacher_id IN (SELECT public.substituted_classroom_teacher_ids(auth.uid())));

DROP POLICY IF EXISTS teacher_select_substituted_children ON public.children;
CREATE POLICY teacher_select_substituted_children ON public.children FOR SELECT
  USING (id IN (SELECT public.substituted_child_ids(auth.uid())));

DROP POLICY IF EXISTS teacher_select_substituted_learning_periods ON public.learning_periods;
CREATE POLICY teacher_select_substituted_learning_periods ON public.learning_periods FOR SELECT
  USING (classroom_id IN (SELECT public.substituted_classroom_ids(auth.uid())));
