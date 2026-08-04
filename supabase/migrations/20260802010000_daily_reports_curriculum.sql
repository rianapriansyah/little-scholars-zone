-- Laporan Akademik Harian — "Materi Hari Ini" section only (prototype).
--
-- Replaces the paper form the assigned teacher fills in for each student after every class.
-- One report per student per date; the teacher saves it as a draft and submits it separately.
-- A report is only visible to the parent once submitted_at is stamped.
--
-- "Class" here is classroom_teacher_id, not classroom_id: since
-- 20260726030000_classroom_multi_teacher.sql a classroom is only a time slot, and the real
-- teaching group (one teacher, max 6 children — see enroll_child_in_classroom) is a
-- classroom_teachers row. That is also what children_classrooms enrolls into.
--
-- The other sections of the paper form (7 aspek perkembangan, pencapaian hari ini, catatan
-- tutor, suasana hati, keterlibatan) are deliberately not built yet. They slot in later as
-- siblings of daily_report_items off the same daily_reports.id, plus scalar columns on
-- daily_reports — no rework of what is here.

-- ---------------------------------------------------------------------------
-- Curriculum catalog
-- ---------------------------------------------------------------------------

CREATE TABLE public.curriculum_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL CHECK (subject IN ('literasi', 'numerasi')),
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Teachers pick from this list, they never type a materi in free-form, so the same materi
-- must not exist twice under one subject.
CREATE UNIQUE INDEX curriculum_items_subject_label_idx ON public.curriculum_items (subject, label);
CREATE INDEX curriculum_items_subject_sort_idx ON public.curriculum_items (subject, sort_order);

-- ---------------------------------------------------------------------------
-- Daily reports
-- ---------------------------------------------------------------------------

CREATE TABLE public.daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.children(id),
  classroom_teacher_id uuid NOT NULL REFERENCES public.classroom_teachers(id),
  report_date date NOT NULL DEFAULT current_date,
  session_id uuid,
  created_by uuid REFERENCES auth.users(id),
  submitted_at timestamptz,
  created_at timestamptz DEFAULT now(),
  -- A child attends one class per day, so one report per child per date — this is the real
  -- business rule. classroom_teacher_id records which group produced it but is deliberately
  -- NOT part of the key: including it would let a mid-day group switch create two reports
  -- for the same child on the same day.
  CONSTRAINT daily_reports_child_date_key UNIQUE (child_id, report_date)
);

COMMENT ON COLUMN public.daily_reports.session_id IS
  'Future anchor: FK to the not-yet-built class_session table. Nullable and unused for now; '
  'once class_session exists, reports hang off a concrete session instead of (class, date).';

COMMENT ON COLUMN public.daily_reports.submitted_at IS
  'NULL = draft, invisible to parents. Stamped by submit_daily_report().';

CREATE INDEX daily_reports_classroom_teacher_date_idx
  ON public.daily_reports (classroom_teacher_id, report_date);
CREATE INDEX daily_reports_child_id_idx ON public.daily_reports (child_id);

CREATE TABLE public.daily_report_items (
  report_id uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  curriculum_item_id uuid NOT NULL REFERENCES public.curriculum_items(id),
  mastery_level smallint NOT NULL CHECK (mastery_level BETWEEN 1 AND 5),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (report_id, curriculum_item_id)
);

COMMENT ON TABLE public.daily_report_items IS
  'Only materi actually covered for that student get a row. No row = not covered today, '
  'never "level 0". mastery_level 1..5; the labels live in src/lib/masteryLevels.ts so '
  'relabeling never needs a migration.';

CREATE INDEX daily_report_items_curriculum_item_id_idx
  ON public.daily_report_items (curriculum_item_id);

GRANT ALL ON public.curriculum_items TO authenticated, service_role;
GRANT ALL ON public.daily_reports TO authenticated, service_role;
GRANT ALL ON public.daily_report_items TO authenticated, service_role;

ALTER TABLE public.curriculum_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_report_items ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS helpers (see 20260701120300_fix_rls_recursion.sql for why these are SECURITY DEFINER)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.teacher_daily_report_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT dr.id
  FROM public.daily_reports dr
  JOIN public.classroom_teachers ct ON ct.id = dr.classroom_teacher_id
  JOIN public.teachers t ON t.id = ct.teacher_id
  WHERE t.auth_user_id = p_auth_uid;
$$;

CREATE OR REPLACE FUNCTION public.family_submitted_daily_report_ids(p_auth_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT dr.id
  FROM public.daily_reports dr
  JOIN public.children c ON c.id = dr.child_id
  JOIN public.families f ON f.id = c.family_id
  WHERE dr.submitted_at IS NOT NULL
    AND f.auth_user_id = p_auth_uid;
$$;

-- True when the current caller may write reports for this teaching group: an admin, or the
-- teacher the group belongs to. Used by the write RPCs, which are SECURITY DEFINER and so
-- bypass the policies below.
CREATE OR REPLACE FUNCTION public.can_write_daily_report(p_classroom_teacher_id uuid)
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
        WHERE ct.id = p_classroom_teacher_id
          AND t.auth_user_id = auth.uid()
      );
$$;

GRANT EXECUTE ON FUNCTION public.teacher_daily_report_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.family_submitted_daily_report_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_daily_report(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- Catalog: everyone signed in reads it (teachers to pick, parents to render labels on a
-- submitted report); only admin maintains it from the Kurikulum screen.
CREATE POLICY admin_all_curriculum_items ON public.curriculum_items FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY authenticated_select_curriculum_items ON public.curriculum_items FOR SELECT
  USING (true);

-- Reports: admin full CRUD; teacher inserts/updates for their own groups but never deletes;
-- parent reads own children's submitted reports only.
CREATE POLICY admin_all_daily_reports ON public.daily_reports FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY teacher_select_own_daily_reports ON public.daily_reports FOR SELECT
  USING (classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

CREATE POLICY teacher_insert_own_daily_reports ON public.daily_reports FOR INSERT
  WITH CHECK (classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

CREATE POLICY teacher_update_own_daily_reports ON public.daily_reports FOR UPDATE
  USING (classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())))
  WITH CHECK (classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid())));

CREATE POLICY parent_select_submitted_daily_reports ON public.daily_reports FOR SELECT
  USING (
    submitted_at IS NOT NULL
    AND child_id IN (SELECT public.family_children_ids(auth.uid()))
  );

CREATE POLICY admin_all_daily_report_items ON public.daily_report_items FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Teachers get DELETE here (unlike on daily_reports) because correcting a draft means
-- removing a materi that turned out not to be covered.
CREATE POLICY teacher_select_own_daily_report_items ON public.daily_report_items FOR SELECT
  USING (report_id IN (SELECT public.teacher_daily_report_ids(auth.uid())));

CREATE POLICY teacher_insert_own_daily_report_items ON public.daily_report_items FOR INSERT
  WITH CHECK (report_id IN (SELECT public.teacher_daily_report_ids(auth.uid())));

CREATE POLICY teacher_update_own_daily_report_items ON public.daily_report_items FOR UPDATE
  USING (report_id IN (SELECT public.teacher_daily_report_ids(auth.uid())))
  WITH CHECK (report_id IN (SELECT public.teacher_daily_report_ids(auth.uid())));

CREATE POLICY teacher_delete_own_daily_report_items ON public.daily_report_items FOR DELETE
  USING (report_id IN (SELECT public.teacher_daily_report_ids(auth.uid())));

CREATE POLICY parent_select_submitted_daily_report_items ON public.daily_report_items FOR SELECT
  USING (report_id IN (SELECT public.family_submitted_daily_report_ids(auth.uid())));

-- ---------------------------------------------------------------------------
-- Write path
-- ---------------------------------------------------------------------------

-- Upserts the report and REPLACES its materi entries with exactly p_entries, in one
-- transaction. Idempotent: calling it twice with the same payload leaves the same state, so
-- the teacher can reopen a draft and correct it. Absence from p_entries means "not covered",
-- so the entry disappears — passing '[]' clears the section.
--
-- p_entries shape: [{"curriculum_item_id": "<uuid>", "mastery_level": 1..5}, ...]
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
    FROM public.daily_reports
    WHERE child_id = p_child_id AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  INSERT INTO public.daily_reports (child_id, classroom_teacher_id, report_date, created_by)
  VALUES (p_child_id, p_classroom_teacher_id, p_report_date, auth.uid())
  ON CONFLICT ON CONSTRAINT daily_reports_child_date_key
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

-- Separate from saving: stamps submitted_at, which is what makes the report visible to the
-- parent. Idempotent — re-submitting keeps the original timestamp.
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
    FROM public.daily_reports
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

  UPDATE public.daily_reports
    SET submitted_at = now()
    WHERE id = p_report_id
    RETURNING submitted_at INTO v_submitted_at;

  RETURN v_submitted_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_daily_report_items(uuid, uuid, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_daily_report(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SEED DATA — PLACEHOLDER. Replace with the real curriculum from the paper form.
-- These 20 items exist only so the entry screen has something to exercise. They are
-- editable from the admin "Kurikulum" screen, so replacing them needs no migration.
-- ---------------------------------------------------------------------------

INSERT INTO public.curriculum_items (subject, label, sort_order) VALUES
  ('literasi', 'Mengenal huruf A–Z', 10),
  ('literasi', 'Membedakan huruf vokal dan konsonan', 20),
  ('literasi', 'Menyebutkan bunyi huruf (fonik)', 30),
  ('literasi', 'Menggabungkan suku kata terbuka (ba, bi, bu)', 40),
  ('literasi', 'Membaca kata sederhana dua suku kata', 50),
  ('literasi', 'Membaca kalimat pendek', 60),
  ('literasi', 'Menulis huruf dengan garis bantu', 70),
  ('literasi', 'Menulis nama sendiri', 80),
  ('literasi', 'Menyimak dan menceritakan kembali cerita pendek', 90),
  ('literasi', 'Mengenal kosakata benda di sekitar', 100),
  ('numerasi', 'Membilang 1–10', 10),
  ('numerasi', 'Membilang 1–20', 20),
  ('numerasi', 'Mengenal lambang bilangan 1–10', 30),
  ('numerasi', 'Mencocokkan jumlah benda dengan angka', 40),
  ('numerasi', 'Mengurutkan bilangan dari kecil ke besar', 50),
  ('numerasi', 'Mengenal bentuk geometri dasar', 60),
  ('numerasi', 'Mengenal pola sederhana (AB, ABC)', 70),
  ('numerasi', 'Membandingkan ukuran (besar–kecil, panjang–pendek)', 80),
  ('numerasi', 'Penjumlahan sederhana dengan benda konkret', 90),
  ('numerasi', 'Pengurangan sederhana dengan benda konkret', 100);
