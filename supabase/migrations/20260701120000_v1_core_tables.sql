-- Little Schoolars Zone v1 core records: families, children, teachers, classrooms, enrollment history.
-- See system-design.md for the full spec this implements.

CREATE TABLE public.families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_phone text,
  contact_email text,
  auth_user_id uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id),
  full_name text NOT NULL,
  birthdate date,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- `email` is not in system-design.md's spec, but is needed (like v2_partners.email in the
-- car-rental app) so the invite-teacher edge function can upsert-then-invite by email.
CREATE TABLE public.teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  contact_phone text,
  email text NOT NULL UNIQUE,
  auth_user_id uuid REFERENCES auth.users(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.classrooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teachers(id),
  label text NOT NULL,
  day_of_week text NOT NULL CHECK (day_of_week IN
    ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  time_start time NOT NULL,
  capacity int NOT NULL DEFAULT 6,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.children_classrooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.children(id),
  classroom_id uuid NOT NULL REFERENCES public.classrooms(id),
  started_at date NOT NULL DEFAULT current_date,
  ended_at date,
  end_reason text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- One active classroom per child at all times.
CREATE UNIQUE INDEX children_classrooms_one_active_idx
  ON public.children_classrooms (child_id) WHERE ended_at IS NULL;

-- Supports upsert-by-email in the invite-family edge function.
CREATE UNIQUE INDEX families_contact_email_idx
  ON public.families (contact_email) WHERE contact_email IS NOT NULL;

CREATE INDEX children_family_id_idx ON public.children (family_id);
CREATE INDEX classrooms_teacher_id_idx ON public.classrooms (teacher_id);
CREATE INDEX children_classrooms_classroom_id_idx ON public.children_classrooms (classroom_id);
CREATE INDEX children_classrooms_child_id_idx ON public.children_classrooms (child_id);

GRANT ALL ON public.families TO authenticated, service_role;
GRANT ALL ON public.children TO authenticated, service_role;
GRANT ALL ON public.teachers TO authenticated, service_role;
GRANT ALL ON public.classrooms TO authenticated, service_role;
GRANT ALL ON public.children_classrooms TO authenticated, service_role;

ALTER TABLE public.families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.children_classrooms ENABLE ROW LEVEL SECURITY;

-- Admin (owner/admin/front_desk collapsed into one role): full access everywhere.
CREATE POLICY admin_all_families ON public.families FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY admin_all_children ON public.children FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY admin_all_teachers ON public.teachers FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY admin_all_classrooms ON public.classrooms FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY admin_all_children_classrooms ON public.children_classrooms FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Parent (family): read own family, own children, own children's current classroom + enrollment rows.
CREATE POLICY parent_select_own_family ON public.families FOR SELECT
  USING (auth_user_id = (SELECT auth.uid()));

CREATE POLICY parent_select_own_children ON public.children FOR SELECT
  USING (family_id = (SELECT id FROM public.families WHERE auth_user_id = auth.uid()));

CREATE POLICY parent_select_classrooms_of_own_children ON public.classrooms FOR SELECT
  USING (id IN (
    SELECT cc.classroom_id FROM public.children_classrooms cc
    JOIN public.children c ON c.id = cc.child_id
    WHERE cc.ended_at IS NULL
      AND c.family_id = (SELECT id FROM public.families WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY parent_select_own_children_classrooms ON public.children_classrooms FOR SELECT
  USING (child_id IN (
    SELECT id FROM public.children
    WHERE family_id = (SELECT id FROM public.families WHERE auth_user_id = auth.uid())
  ));

-- Teacher: read own profile, own classrooms, and children currently enrolled in those classrooms.
CREATE POLICY teacher_select_own_profile ON public.teachers FOR SELECT
  USING (auth_user_id = (SELECT auth.uid()));

CREATE POLICY teacher_select_own_classrooms ON public.classrooms FOR SELECT
  USING (teacher_id = (SELECT id FROM public.teachers WHERE auth_user_id = auth.uid()));

CREATE POLICY teacher_select_own_children_classrooms ON public.children_classrooms FOR SELECT
  USING (classroom_id IN (
    SELECT id FROM public.classrooms
    WHERE teacher_id = (SELECT id FROM public.teachers WHERE auth_user_id = auth.uid())
  ));

CREATE POLICY teacher_select_own_children ON public.children FOR SELECT
  USING (id IN (
    SELECT cc.child_id FROM public.children_classrooms cc
    JOIN public.classrooms cl ON cl.id = cc.classroom_id
    WHERE cc.ended_at IS NULL
      AND cl.teacher_id = (SELECT id FROM public.teachers WHERE auth_user_id = auth.uid())
  ));
