-- A child can hold learning periods in several classrooms at once (Calistung *and* Mengaji),
-- and each of those programs needs its own class/teacher group. Until now enrollment was
-- capped at one active row per child (children_classrooms_one_active_idx), which made the
-- second program unenrollable — the case supabase/tests/learning_periods.test.sql had to drop
-- the index to exercise. The cap moves down one level: one active enrollment per
-- (child, classroom), so a child sits in at most one group per program.

DROP INDEX public.children_classrooms_one_active_idx;

-- classroom_id lives on classroom_teachers, not on children_classrooms (see
-- 20260726030000_classroom_multi_teacher.sql), so the constraint cannot be a partial unique
-- index any more — it needs the join. Same race window the RPCs below already had.
CREATE OR REPLACE FUNCTION public.children_classrooms_one_active_per_classroom()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_classroom_id uuid;
BEGIN
  IF NEW.ended_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT classroom_id INTO v_classroom_id
    FROM public.classroom_teachers
    WHERE id = NEW.classroom_teacher_id;

  IF EXISTS (
    SELECT 1
    FROM public.children_classrooms cc
    JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
    WHERE cc.child_id = NEW.child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = v_classroom_id
      AND cc.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Child already has an active enrollment in this classroom';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER children_classrooms_one_active_per_classroom_trg
  BEFORE INSERT OR UPDATE ON public.children_classrooms
  FOR EACH ROW EXECUTE FUNCTION public.children_classrooms_one_active_per_classroom();

-- Enrollment RPCs: every "does this child already have a class" test narrows to the classroom
-- the target group belongs to. Enrolling into Mengaji must not see, close, or be blocked by an
-- active Calistung enrollment.

CREATE OR REPLACE FUNCTION public.enroll_child_in_classroom(p_child_id uuid, p_classroom_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_id uuid;
  v_count int;
BEGIN
  SELECT classroom_id INTO v_classroom_id
    FROM public.classroom_teachers
    WHERE id = p_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.children_classrooms cc
    JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
    WHERE cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = v_classroom_id
  ) THEN
    RAISE EXCEPTION 'Child already has an active enrollment in this classroom; use switch_classroom instead';
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

CREATE OR REPLACE FUNCTION public.switch_classroom(
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
  v_classroom_id uuid;
  v_count int;
BEGIN
  SELECT classroom_id INTO v_classroom_id
    FROM public.classroom_teachers
    WHERE id = p_new_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_teacher_id = p_new_classroom_teacher_id AND ended_at IS NULL;

  IF v_count >= 6 THEN
    RAISE EXCEPTION 'This teacher already has the maximum of 6 students';
  END IF;

  -- Only the enrollment in the same program is closed; the child keeps their other programs.
  UPDATE public.children_classrooms cc
    SET ended_at = current_date, end_reason = p_end_reason
    FROM public.classroom_teachers ct
    WHERE ct.id = cc.classroom_teacher_id
      AND cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = v_classroom_id;

  INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at, created_by)
  VALUES (p_child_id, p_new_classroom_teacher_id, current_date, auth.uid());
END;
$$;

-- unenroll_child closed *every* open enrollment a child had, which now means "drop them from
-- all their programs" — never what the admin roster screen's per-group delete button meant.
-- Re-signed to take the group the child is being removed from.
DROP FUNCTION IF EXISTS public.unenroll_child(uuid, text);

CREATE FUNCTION public.unenroll_child(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_end_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.children_classrooms
    SET ended_at = current_date, end_reason = p_end_reason
    WHERE child_id = p_child_id
      AND classroom_teacher_id = p_classroom_teacher_id
      AND ended_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Child has no active enrollment in this class';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enroll_child_in_classroom(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_classroom(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unenroll_child(uuid, uuid, text) TO authenticated, service_role;
