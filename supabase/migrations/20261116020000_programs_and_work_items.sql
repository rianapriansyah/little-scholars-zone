-- Phase 1 of the employee work refactor: add programs and work items next to what exists.
--
-- Until now a "classroom" meant two things: a class parents buy, and a slot of paid staff work
-- (Piket, Konten, Aktivitas were created as non-billable classrooms). The rate lived on the class
-- (classrooms.teacher_rate). The refactor separates the two:
--
--   office_branch ─┬─< programs   (teaching; hourly_rate is THE teacher rate) ─< classrooms
--                  └─< work_items (all other paid work; hourly_rate is THE rate)
--   classroom_teachers ── classroom_id (teaching)  or  work_item_id (other work)
--
-- This migration is ADDITIVE ONLY. Nothing existing is changed or removed, so the app in production
-- keeps working exactly as before:
--   * new tables programs and work_items, admin-managed, teachers read the rows they work on;
--   * new nullable columns classrooms.program_id, classroom_teachers.work_item_id/time_start/time_end;
--   * backfill: 5 programs for the 13 real classes, 8 work items, and work_item_id + times on the
--     26 staff-work assignments, which still point at their old classroom for now (Phase 3 moves them);
--   * view employee_assignment_rates: the one place an assignment's rate is read from.
--
-- The checks at the end compare against backup.pay_baseline_20261116 (20261116010000): every
-- assignment must get exactly the rate it is paid today, so pay stays identical.
--
-- Rollback: supabase/rollbacks/20261116020000_programs_and_work_items.sql

-- ── programs ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES public.office_branch (id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  hourly_rate numeric(12, 2) NOT NULL CHECK (hourly_rate > 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX programs_branch_name_key ON public.programs (branch_id, lower(btrim(name)));

COMMENT ON TABLE public.programs IS
  'What parents buy (Bimba, Mengaji, Daycare...). hourly_rate is the only source of a teacher''s '
  'rate: every class slot (classrooms row) of the program pays it. The parent price stays on the slot.';

-- ── work_items ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.work_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id   uuid NOT NULL REFERENCES public.office_branch (id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  hourly_rate numeric(12, 2) NOT NULL CHECK (hourly_rate > 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX work_items_branch_name_key ON public.work_items (branch_id, lower(btrim(name)));

COMMENT ON TABLE public.work_items IS
  'Paid work that is not teaching a class (Piket, Konten, Caregiving, Kasir, Kerja Akhir Pekan). '
  'hourly_rate is the only source of the rate. One row per branch, so pay can be split per branch.';

-- ── links ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.classrooms
  ADD COLUMN program_id uuid REFERENCES public.programs (id) ON DELETE RESTRICT;
CREATE INDEX classrooms_program_id_idx ON public.classrooms (program_id);

ALTER TABLE public.classroom_teachers
  ADD COLUMN work_item_id uuid REFERENCES public.work_items (id) ON DELETE RESTRICT,
  ADD COLUMN time_start time,
  ADD COLUMN time_end time,
  ADD CONSTRAINT classroom_teachers_work_item_times_check
    CHECK (work_item_id IS NULL OR (time_start IS NOT NULL AND time_end IS NOT NULL AND time_end > time_start));
CREATE INDEX classroom_teachers_work_item_id_idx ON public.classroom_teachers (work_item_id);

COMMENT ON COLUMN public.classrooms.program_id IS
  'The program this class slot belongs to; the teacher rate comes from programs.hourly_rate. '
  'NULL only on the old staff-work classrooms, which leave this table in a later phase.';
COMMENT ON COLUMN public.classroom_teachers.work_item_id IS
  'Set for non-teaching work: the rate and branch come from this work item, and the schedule from '
  'time_start/time_end. NULL for teaching, where both come from the class and its program.';

-- ── access ────────────────────────────────────────────────────────────────────────────────────
-- Admin manages both tables. A teacher reads only the programs of the classes they teach or cover,
-- and the work items they are assigned to, which is what their own pay estimate needs. Parents and
-- anon read nothing. Grants: revoke first, as office_branch does, so anon gets nothing by default.
REVOKE ALL ON public.programs, public.work_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.programs, public.work_items TO authenticated, service_role;

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_programs ON public.programs FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY teacher_select_own_programs ON public.programs FOR SELECT
  USING (id IN (
    SELECT c.program_id FROM public.classrooms c
    WHERE c.id IN (SELECT public.teacher_classroom_ids(auth.uid()))
       OR c.id IN (SELECT public.substituted_classroom_ids(auth.uid()))
  ));

CREATE POLICY admin_all_work_items ON public.work_items FOR ALL
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY teacher_select_own_work_items ON public.work_items FOR SELECT
  USING (id IN (
    SELECT ct.work_item_id FROM public.classroom_teachers ct
    WHERE ct.teacher_id = (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
       OR ct.id IN (SELECT public.substituted_classroom_teacher_ids(auth.uid()))
  ));

-- ── backfill ──────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  bimba uuid := (SELECT id FROM public.office_branch WHERE name = 'Bimba Little Schoolars Zone');
  rucil uuid := (SELECT id FROM public.office_branch WHERE name = 'Rumah Main Rumah Kecil (Rucil)');
BEGIN
  IF bimba IS NULL OR rucil IS NULL THEN
    RAISE EXCEPTION 'Expected both office branches (Bimba, Rucil) to exist';
  END IF;

  INSERT INTO public.programs (branch_id, name, hourly_rate) VALUES
    (bimba, 'Bimba',              8000),
    (bimba, 'Mengaji',            10000),
    (rucil, 'Rumah Kecil',        8000),
    (rucil, 'Khusus Rumah Kecil', 8000),
    (rucil, 'Daycare',            8000);

  INSERT INTO public.work_items (branch_id, name, hourly_rate) VALUES
    (bimba, 'Piket',             8000),
    (rucil, 'Piket',             5000),
    (bimba, 'Konten',            8000),
    (rucil, 'Konten',            8000),
    (rucil, 'Caregiving',        5000),
    (rucil, 'Kasir',             8000),
    (bimba, 'Kerja Akhir Pekan', 8000),
    (rucil, 'Kerja Akhir Pekan', 8000);

  -- Class slots → program, by today's labels. The patterns do not overlap: "Kelas Rumah Kecil %"
  -- cannot match "Kelas Khusus Rumah Kecil ...". The checks below catch any slot left unmapped.
  UPDATE public.classrooms c SET program_id = p.id
  FROM public.programs p
  WHERE (c.label LIKE 'Kelas Bimba %'              AND p.branch_id = bimba AND p.name = 'Bimba')
     OR (c.label LIKE 'Kelas Mengaji Bimba %'      AND p.branch_id = bimba AND p.name = 'Mengaji')
     OR (c.label LIKE 'Kelas Rumah Kecil %'        AND p.branch_id = rucil AND p.name = 'Rumah Kecil')
     OR (c.label LIKE 'Kelas Khusus Rumah Kecil %' AND p.branch_id = rucil AND p.name = 'Khusus Rumah Kecil')
     OR (c.label LIKE 'Daycare %'                  AND p.branch_id = rucil AND p.name = 'Daycare');

  -- Staff-work assignments → work item, keeping the times of the classroom they sit on today.
  UPDATE public.classroom_teachers ct
  SET work_item_id = w.id, time_start = c.time_start, time_end = c.time_end
  FROM public.classrooms c, public.work_items w
  WHERE c.id = ct.classroom_id
    AND (   (c.label LIKE 'Piket Pagi Bimba%'       AND w.branch_id = bimba AND w.name = 'Piket')
         OR (c.label LIKE 'Piket Pagi Rumah Kecil%' AND w.branch_id = rucil AND w.name = 'Piket')
         OR (c.label LIKE 'Konten%'                 AND w.branch_id = bimba AND w.name = 'Konten')
         OR (c.label LIKE 'Aktivitas%'              AND w.branch_id = rucil AND w.name = 'Caregiving'));
END;
$$;

-- ── the rate, read from one place ─────────────────────────────────────────────────────────────
-- A work item wins when set (staff work); otherwise the class's program (teaching). During the
-- transition the 26 staff-work assignments still carry their old classroom_id too, which is why the
-- work item is checked first.
CREATE VIEW public.employee_assignment_rates
WITH (security_invoker = true) AS
SELECT
  ct.id         AS classroom_teacher_id,
  ct.teacher_id AS employee_id,
  CASE WHEN ct.work_item_id IS NOT NULL THEN 'work_item' ELSE 'program' END AS rate_source,
  w.id          AS work_item_id,
  p.id          AS program_id,
  coalesce(w.branch_id, p.branch_id)     AS branch_id,
  coalesce(w.name, p.name)               AS work_name,
  CASE WHEN ct.work_item_id IS NOT NULL THEN w.hourly_rate ELSE p.hourly_rate END AS hourly_rate
FROM public.classroom_teachers ct
LEFT JOIN public.work_items w ON w.id = ct.work_item_id
LEFT JOIN public.classrooms c ON c.id = ct.classroom_id
LEFT JOIN public.programs p ON p.id = c.program_id;

REVOKE ALL ON public.employee_assignment_rates FROM PUBLIC, anon;
GRANT SELECT ON public.employee_assignment_rates TO authenticated, service_role;

COMMENT ON VIEW public.employee_assignment_rates IS
  'The hourly rate of every assignment: work_items.hourly_rate for staff work, otherwise '
  'programs.hourly_rate through the class. security_invoker, so callers see only the rows their '
  'RLS allows. Replaces classrooms.teacher_rate as the pay source.';

-- ── checks ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n bigint;
BEGIN
  IF (SELECT count(*) FROM public.programs) <> 5 OR (SELECT count(*) FROM public.work_items) <> 8 THEN
    RAISE EXCEPTION 'Expected 5 programs and 8 work items';
  END IF;

  -- Every billable class has a program; no staff classroom has one.
  SELECT count(*) INTO n FROM public.classrooms WHERE is_billable AND program_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% billable classrooms have no program', n; END IF;
  SELECT count(*) INTO n FROM public.classrooms WHERE NOT is_billable AND program_id IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION '% staff classrooms were given a program', n; END IF;

  -- Every assignment on a staff classroom has a work item; no teaching assignment has one.
  SELECT count(*) INTO n FROM public.classroom_teachers ct JOIN public.classrooms c ON c.id = ct.classroom_id
   WHERE NOT c.is_billable AND ct.work_item_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% staff-work assignments have no work item', n; END IF;
  SELECT count(*) INTO n FROM public.classroom_teachers ct JOIN public.classrooms c ON c.id = ct.classroom_id
   WHERE c.is_billable AND ct.work_item_id IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION '% teaching assignments were given a work item', n; END IF;

  -- Every assignment has a rate, and it is exactly today's classrooms.teacher_rate.
  SELECT count(*) INTO n FROM public.employee_assignment_rates WHERE hourly_rate IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% assignments have no rate', n; END IF;

  SELECT count(*) INTO n
  FROM public.employee_assignment_rates r
  JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
  JOIN public.classrooms c ON c.id = ct.classroom_id
  WHERE r.hourly_rate IS DISTINCT FROM c.teacher_rate;
  IF n > 0 THEN RAISE EXCEPTION '% assignments would get a different rate than today', n; END IF;

  -- Pay per employee per month, recomputed from the new rate source, equals the frozen baseline.
  SELECT count(*) INTO n
  FROM (
    SELECT b.employee_id, b.month, sum(b.pay) AS old_pay, sum(b.minutes / 60.0 * r.hourly_rate) AS new_pay
    FROM backup.pay_baseline_20261116 b
    JOIN public.employee_assignment_rates r ON r.classroom_teacher_id = b.classroom_teacher_id
    GROUP BY b.employee_id, b.month
  ) x
  WHERE round(x.old_pay, 2) <> round(x.new_pay, 2);
  IF n > 0 THEN RAISE EXCEPTION 'Pay differs from the baseline for % employee-months', n; END IF;
END;
$$;
