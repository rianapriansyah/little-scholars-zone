-- Flexible hours belong to the work item, not to each person's assignment: whoever is assigned to
-- a work item clocks in the same way. (Owner's decision, 18 Nov.)
--
--   * work_items.is_flexi_hours (NOT NULL, default false). Konten (Bimba and Rucil) is flexible;
--     every other item has fixed hours. employee_assignment_schedules now reads the item's flag, so
--     every clock-in rule follows it.
--   * "Caregiving" (Rucil) is renamed "Daily Activity Work": caregiving for daycare children
--     (08:00–14:00) is the Daycare program's classes, which the owner sets up herself; this item is
--     the general activity work of 10:00–19:30. Same id, so its assignments and clock-ins stay. It
--     has fixed hours: its 4 evening (17:30–19:30) assignments were flexible and become fixed.
--       - Their 28 days with a single work session identical to the clock-in/out lose that session:
--         minutes are the same either way, and without it an admin edit of that day recomputes
--         from the clock times as on every fixed assignment.
--       - Their 4 days with a real break (2–3 sessions) keep their sessions, so the minutes worked
--         stay exactly as recorded.
--   * employee_assignments.is_flexi_hours is synced to its item and no longer required; the app
--     build that stops writing it is deployed next, then 20261118060000 drops it.
--
-- Checked below: minutes_taught of every clock-in and pay per person per month are unchanged; the
-- late/early labels change only on the 4 evening Daily Activity Work assignments.
--
-- Rollback: supabase/rollbacks/20261118050000_flexi_hours_on_work_items.sql

BEGIN;

CREATE TEMP TABLE evening ON COMMIT DROP AS
  SELECT id FROM public.employee_assignments
   WHERE work_item_id = '0523051e-14df-4f3f-8cfe-128d8462b797' AND is_flexi_hours;

-- ── Preconditions ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  mixed text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.work_items
                  WHERE id = '0523051e-14df-4f3f-8cfe-128d8462b797' AND name = 'Caregiving') THEN
    RAISE EXCEPTION 'Caregiving work item not found under its id';
  END IF;
  IF (SELECT count(*) FROM evening) <> 4 THEN
    RAISE EXCEPTION 'expected 4 flexible Caregiving assignments, found %', (SELECT count(*) FROM evening);
  END IF;
  -- Any other item must already be all-flexible or all-fixed, or moving the flag would change it.
  SELECT string_agg(w.name, ', ') INTO mixed
    FROM public.work_items w
   WHERE w.id <> '0523051e-14df-4f3f-8cfe-128d8462b797'
     AND (SELECT count(DISTINCT ea.is_flexi_hours) FROM public.employee_assignments ea WHERE ea.work_item_id = w.id) > 1;
  IF mixed IS NOT NULL THEN
    RAISE EXCEPTION 'work items with both flexible and fixed assignments: %', mixed;
  END IF;
END $$;

CREATE TEMP TABLE status_before ON COMMIT DROP AS
  SELECT s.id, s.classroom_teacher_id, s.minutes_taught, s.arrival_status, s.departure_status
  FROM public.employee_attendance_status s;
CREATE TEMP TABLE pay_before ON COMMIT DROP AS
  SELECT ea.teacher_id, date_trunc('month', s.session_date) AS month,
         sum(coalesce(s.minutes_taught, 0) * r.hourly_rate / 60.0) AS pay
  FROM public.employee_attendance_status s
  JOIN public.employee_assignments ea ON ea.id = s.classroom_teacher_id
  JOIN public.employee_assignment_rates r ON r.classroom_teacher_id = ea.id
  GROUP BY 1, 2;

-- ── Backups ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE backup.assignment_flexi_20261118 AS
  SELECT id, is_flexi_hours FROM public.employee_assignments WHERE work_item_id IS NOT NULL;
CREATE TABLE backup.daily_activity_sessions_20261118 AS
  SELECT s.* FROM public.employee_work_sessions s
  JOIN public.employee_attendances a ON a.id = s.attendance_id
  WHERE a.classroom_teacher_id IN (SELECT id FROM evening)
    AND (SELECT count(*) FROM public.employee_work_sessions s2 WHERE s2.attendance_id = a.id) = 1
    AND s.started_at = a.clocked_in_at
    AND s.ended_at IS NOT DISTINCT FROM a.clocked_out_at;

-- ── The item's flag ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.work_items ADD COLUMN is_flexi_hours boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.work_items.is_flexi_hours IS
  'true = no fixed hours to clock in/out against (e.g. Konten): clock-in/out any time, work sessions '
  'with breaks, arrival/departure status ''not_applicable''. Applies to everyone assigned to the '
  'item; the times on their assignment are then only shown. false = each assignment''s own times '
  'are its schedule.';

UPDATE public.work_items w SET is_flexi_hours = true
 WHERE w.id <> '0523051e-14df-4f3f-8cfe-128d8462b797'
   AND EXISTS (SELECT 1 FROM public.employee_assignments ea WHERE ea.work_item_id = w.id AND ea.is_flexi_hours);

UPDATE public.work_items SET name = 'Daily Activity Work'
 WHERE id = '0523051e-14df-4f3f-8cfe-128d8462b797';

-- The old column follows its item until it is dropped, so the build still live reads the truth.
ALTER TABLE public.employee_assignments DROP CONSTRAINT employee_assignments_work_item_flexi_check;
UPDATE public.employee_assignments ea SET is_flexi_hours = w.is_flexi_hours
  FROM public.work_items w WHERE w.id = ea.work_item_id;

-- Single sessions identical to their clock-in/out, on the evening assignments now fixed.
DELETE FROM public.employee_work_sessions
 WHERE id IN (SELECT id FROM backup.daily_activity_sessions_20261118);

-- ── Schedules read the item ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.employee_assignment_schedules WITH (security_invoker = true) AS
SELECT ct.id AS classroom_teacher_id,
       ct.teacher_id AS employee_id,
       ct.classroom_id,
       ct.work_item_id,
       CASE WHEN ct.work_item_id IS NOT NULL THEN (w.name || ' — ') || b.name ELSE c.label END AS label,
       CASE WHEN ct.work_item_id IS NOT NULL THEN ct.time_start ELSE c.time_start END AS time_start,
       CASE WHEN ct.work_item_id IS NOT NULL THEN ct.time_end ELSE c.time_end END AS time_end,
       -- A class always has fixed hours; staff work follows its work item.
       CASE WHEN ct.work_item_id IS NOT NULL THEN w.is_flexi_hours ELSE false END AS is_flexi_hours,
       CASE WHEN ct.work_item_id IS NOT NULL THEN w.active ELSE c.active END AS active
  FROM public.employee_assignments ct
  LEFT JOIN public.classrooms c ON c.id = ct.classroom_id
  LEFT JOIN public.work_items w ON w.id = ct.work_item_id
  LEFT JOIN public.office_branch b ON b.id = w.branch_id;

COMMENT ON VIEW public.employee_assignment_schedules IS
  'When and how each assignment is worked: label, times, flexi, active. Staff work reads its work '
  'item (flexible or not, for everyone on it) and its own times; teaching reads its class, always '
  'fixed hours. Every clock-in rule reads this view. security_invoker, so app callers see only the '
  'assignments their RLS allows.';

-- ── Checks ──────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n int;
  leftovers text;
BEGIN
  IF (SELECT count(*) FROM backup.daily_activity_sessions_20261118) <> 28 THEN
    RAISE EXCEPTION 'expected to remove 28 single sessions, found %', (SELECT count(*) FROM backup.daily_activity_sessions_20261118);
  END IF;

  SELECT count(*) INTO n
    FROM status_before b
    FULL JOIN public.employee_attendance_status s ON s.id = b.id
   WHERE b.id IS NULL OR s.id IS NULL OR b.minutes_taught IS DISTINCT FROM s.minutes_taught;
  IF n <> 0 THEN
    RAISE EXCEPTION '% clock-ins changed their minutes', n;
  END IF;

  SELECT count(*) INTO n
    FROM status_before b JOIN public.employee_attendance_status s ON s.id = b.id
   WHERE b.classroom_teacher_id NOT IN (SELECT id FROM evening)
     AND (b.arrival_status IS DISTINCT FROM s.arrival_status OR b.departure_status IS DISTINCT FROM s.departure_status);
  IF n <> 0 THEN
    RAISE EXCEPTION '% clock-ins outside the evening Daily Activity Work changed their status', n;
  END IF;

  SELECT count(*) INTO n
    FROM pay_before b
    FULL JOIN (
      SELECT ea.teacher_id, date_trunc('month', s.session_date) AS month,
             sum(coalesce(s.minutes_taught, 0) * r.hourly_rate / 60.0) AS pay
      FROM public.employee_attendance_status s
      JOIN public.employee_assignments ea ON ea.id = s.classroom_teacher_id
      JOIN public.employee_assignment_rates r ON r.classroom_teacher_id = ea.id
      GROUP BY 1, 2) a ON a.teacher_id = b.teacher_id AND a.month = b.month
   WHERE b.pay IS DISTINCT FROM a.pay;
  IF n <> 0 THEN
    RAISE EXCEPTION 'pay changed for % person-months', n;
  END IF;

  IF (SELECT string_agg(name, ',' ORDER BY name) FROM public.work_items WHERE is_flexi_hours) IS DISTINCT FROM 'Konten,Konten' THEN
    RAISE EXCEPTION 'flexible work items are not exactly the two Konten items: %',
      (SELECT string_agg(name, ',' ORDER BY name) FROM public.work_items WHERE is_flexi_hours);
  END IF;

  SELECT string_agg(c.relname, ', ') INTO leftovers FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
     AND NOT coalesce(c.reloptions::text ~ 'security_invoker=(true|on)', false);
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'views without security_invoker: %', leftovers;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
