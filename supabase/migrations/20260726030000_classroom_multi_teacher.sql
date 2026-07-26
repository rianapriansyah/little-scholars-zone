-- Classrooms can now have more than one teacher. Each teacher forms their own group within
-- a classroom (e.g. "Kelas A (Gina)" and "Kelas A (Sari)" are two separate groups in the same
-- classroom), and each group is capped at 6 students. Enrollment now targets a specific
-- (classroom, teacher) pair via classroom_teachers, not the classroom directly.
--
-- No backfill needed: at time of writing there are zero classrooms with a teacher assigned
-- and zero children_classrooms rows (verified live before writing this migration).

CREATE TABLE public.classroom_teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id),
  teacher_id uuid NOT NULL REFERENCES public.teachers(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (classroom_id, teacher_id)
);

CREATE INDEX classroom_teachers_classroom_id_idx ON public.classroom_teachers (classroom_id);
CREATE INDEX classroom_teachers_teacher_id_idx ON public.classroom_teachers (teacher_id);

GRANT ALL ON public.classroom_teachers TO authenticated, service_role;
ALTER TABLE public.classroom_teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_classroom_teachers ON public.classroom_teachers FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY teacher_select_own_classroom_teachers ON public.classroom_teachers FOR SELECT
  USING (teacher_id = (SELECT id FROM public.teachers WHERE auth_user_id = auth.uid()));

-- These two policies depend on columns we're about to drop (classrooms.teacher_id,
-- children_classrooms.classroom_id) — drop them now, recreated further down once the
-- replacement helper functions are in place.
DROP POLICY IF EXISTS teacher_select_own_classrooms ON public.classrooms;
DROP POLICY IF EXISTS teacher_select_own_children_classrooms ON public.children_classrooms;

-- children_classrooms now enrolls a child into a specific (classroom, teacher) group.
ALTER TABLE public.children_classrooms
  ADD COLUMN classroom_teacher_id uuid REFERENCES public.classroom_teachers(id);
ALTER TABLE public.children_classrooms ALTER COLUMN classroom_teacher_id SET NOT NULL;
ALTER TABLE public.children_classrooms DROP COLUMN classroom_id;
CREATE INDEX children_classrooms_classroom_teacher_id_idx ON public.children_classrooms (classroom_teacher_id);

-- teacher_id lived directly on classrooms (1 teacher max); capacity was a fixed per-classroom
-- number. Both are superseded by classroom_teachers + the hardcoded 6-per-teacher cap below.
ALTER TABLE public.classrooms DROP COLUMN teacher_id;
ALTER TABLE public.classrooms DROP COLUMN capacity;

-- Enrollment RPCs: re-point at classroom_teacher_id and hardcode the 6-per-teacher cap.
DROP FUNCTION IF EXISTS public.enroll_child_in_classroom(uuid, uuid);
DROP FUNCTION IF EXISTS public.switch_classroom(uuid, uuid, text);

CREATE FUNCTION public.enroll_child_in_classroom(p_child_id uuid, p_classroom_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.classroom_teachers WHERE id = p_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.children_classrooms WHERE child_id = p_child_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Child already has an active classroom enrollment; use switch_classroom instead';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_teacher_id = p_classroom_teacher_id AND ended_at IS NULL;

  IF v_count >= 6 THEN
    RAISE EXCEPTION 'This teacher already has the maximum of 6 students';
  END IF;

  INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at, created_by)
  VALUES (p_child_id, p_classroom_teacher_id, current_date, auth.uid());
END;
$$;

CREATE FUNCTION public.switch_classroom(
  p_child_id uuid,
  p_new_classroom_teacher_id uuid,
  p_end_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.classroom_teachers WHERE id = p_new_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_teacher_id = p_new_classroom_teacher_id AND ended_at IS NULL;

  IF v_count >= 6 THEN
    RAISE EXCEPTION 'This teacher already has the maximum of 6 students';
  END IF;

  UPDATE public.children_classrooms
    SET ended_at = current_date, end_reason = p_end_reason
    WHERE child_id = p_child_id AND ended_at IS NULL;

  INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at, created_by)
  VALUES (p_child_id, p_new_classroom_teacher_id, current_date, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.enroll_child_in_classroom(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_classroom(uuid, uuid, text) TO authenticated, service_role;

-- RLS helper functions (see 20260701120300_fix_rls_recursion.sql): re-point through
-- classroom_teachers now that classrooms.teacher_id and children_classrooms.classroom_id
-- are both gone. Two new helpers added for classroom_teacher-scoped lookups.

CREATE OR REPLACE FUNCTION public.family_active_classroom_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ct.classroom_id
  FROM public.children_classrooms cc
  JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
  JOIN public.children c ON c.id = cc.child_id
  JOIN public.families f ON f.id = c.family_id
  WHERE cc.ended_at IS NULL
    AND f.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.family_active_classroom_teacher_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT cc.classroom_teacher_id
  FROM public.children_classrooms cc
  JOIN public.children c ON c.id = cc.child_id
  JOIN public.families f ON f.id = c.family_id
  WHERE cc.ended_at IS NULL
    AND f.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.teacher_classroom_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ct.classroom_id
  FROM public.classroom_teachers ct
  JOIN public.teachers t ON t.id = ct.teacher_id
  WHERE t.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.teacher_classroom_teacher_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ct.id
  FROM public.classroom_teachers ct
  JOIN public.teachers t ON t.id = ct.teacher_id
  WHERE t.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.teacher_enrolled_child_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT cc.child_id
  FROM public.children_classrooms cc
  JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
  JOIN public.teachers t ON t.id = ct.teacher_id
  WHERE cc.ended_at IS NULL
    AND t.auth_user_id = p_auth_uid;
$$;

-- Policies whose USING clause referenced the now-removed classrooms.teacher_id or
-- children_classrooms.classroom_id columns.

DROP POLICY IF EXISTS teacher_select_own_classrooms ON public.classrooms;
CREATE POLICY teacher_select_own_classrooms ON public.classrooms FOR SELECT
  USING (id IN (SELECT public.teacher_classroom_ids(auth.uid())));

DROP POLICY IF EXISTS teacher_select_own_children_classrooms ON public.children_classrooms;
CREATE POLICY teacher_select_own_children_classrooms ON public.children_classrooms FOR SELECT
  USING (classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

-- New: parents need SELECT on classroom_teachers to embed classrooms/teachers through it.
CREATE POLICY parent_select_classroom_teachers_of_own_children ON public.classroom_teachers FOR SELECT
  USING (id IN (SELECT public.family_active_classroom_teacher_ids(auth.uid())));
