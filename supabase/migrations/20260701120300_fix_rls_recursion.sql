-- Fix infinite recursion in RLS policies caused by circular cross-table references.
-- Chain 1: classrooms policy → children_classrooms → classrooms (loop)
-- Chain 2: children_classrooms policy → children → children_classrooms (loop)
--
-- Solution: security definer helper functions that bypass RLS for inner lookups.

CREATE OR REPLACE FUNCTION public.family_active_classroom_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT cc.classroom_id
  FROM public.children_classrooms cc
  JOIN public.children c ON c.id = cc.child_id
  JOIN public.families f ON f.id = c.family_id
  WHERE cc.ended_at IS NULL
    AND f.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.family_children_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.id
  FROM public.children c
  JOIN public.families f ON f.id = c.family_id
  WHERE f.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.teacher_classroom_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT cl.id
  FROM public.classrooms cl
  JOIN public.teachers t ON t.id = cl.teacher_id
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
  JOIN public.classrooms cl ON cl.id = cc.classroom_id
  JOIN public.teachers t ON t.id = cl.teacher_id
  WHERE cc.ended_at IS NULL
    AND t.auth_user_id = p_auth_uid;
$$;

-- Recreate the four policies that caused the recursion

DROP POLICY IF EXISTS parent_select_classrooms_of_own_children ON public.classrooms;
CREATE POLICY parent_select_classrooms_of_own_children ON public.classrooms FOR SELECT
  USING (id IN (SELECT public.family_active_classroom_ids(auth.uid())));

DROP POLICY IF EXISTS parent_select_own_children_classrooms ON public.children_classrooms;
CREATE POLICY parent_select_own_children_classrooms ON public.children_classrooms FOR SELECT
  USING (child_id IN (SELECT public.family_children_ids(auth.uid())));

DROP POLICY IF EXISTS teacher_select_own_children_classrooms ON public.children_classrooms;
CREATE POLICY teacher_select_own_children_classrooms ON public.children_classrooms FOR SELECT
  USING (classroom_id IN (SELECT public.teacher_classroom_ids(auth.uid())));

DROP POLICY IF EXISTS teacher_select_own_children ON public.children;
CREATE POLICY teacher_select_own_children ON public.children FOR SELECT
  USING (id IN (SELECT public.teacher_enrolled_child_ids(auth.uid())));
