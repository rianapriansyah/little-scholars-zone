-- Miss Rani's five Konten · Bimba assignments become one.
--
-- Konten used to be five fake classrooms, one per time slot (08.00, 10.00, 13.30, 15.30, 17.30), and
-- Miss Rani was assigned to each. Since 20261116060000 they are five assignments to the same flexi
-- work item, so her home screen shows five identical Konten cards and Kelola Item Kerja lists her
-- five times. She clocked into two or more of them on 10 of her 11 working days.
--
-- Konten is flexi, so the slots never meant anything. They are merged into one assignment, and each
-- day's clock-ins become sessions of one day. Hours are SUMMED per date, as they are paid today
-- (where two of her slots overlapped, both stretches still count). The only difference is rounding:
-- a day is now rounded once instead of per clock-in, which takes 1 minute off 3 and 6 Nov (about
-- Rp 267 in November). Steps:
--
--   1. every one of her Konten clock-ins gets its session rows (older ones only had in/out);
--   2. the kept assignment is her earliest slot; on a day it has no clock-in, one of the other
--      slots' clock-ins is moved onto it;
--   3. every other clock-in of that day hands its sessions to the kept day and is removed;
--   4. each merged day's jam masuk/selesai become its first start and last finish (left open if a
--      session is still running, as the clock-in RPCs do);
--   5. the four emptied assignments are removed, and the kept one spans 08.00–20.30 (display only).
--
-- Pinned to Miss Rani's id and asserted to touch exactly five assignments with no substitutions or
-- children. Everything touched is copied to the backup schema first, for the rollback.
--
-- Rollback: supabase/rollbacks/20261116080000_merge_rani_konten.sql

CREATE TEMP TABLE konten ON COMMIT DROP AS
SELECT ct.id, ct.time_start, ct.time_end,
       first_value(ct.id) OVER (ORDER BY ct.time_start, ct.id) AS keep_id
FROM public.classroom_teachers ct
JOIN public.work_items w ON w.id = ct.work_item_id
JOIN public.office_branch b ON b.id = w.branch_id
JOIN public.employees e ON e.id = ct.teacher_id
WHERE w.name = 'Konten' AND b.name = 'Bimba Little Schoolars Zone'
  AND e.id = (SELECT id FROM public.employees WHERE call_name = 'Miss Rani');

DO $$
BEGIN
  IF (SELECT count(*) FROM konten) <> 5 THEN
    RAISE EXCEPTION 'Expected Miss Rani to have 5 Konten · Bimba assignments, found %', (SELECT count(*) FROM konten);
  END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_teachers ct JOIN konten k ON k.id = ct.id WHERE NOT ct.is_flexi_hours) THEN
    RAISE EXCEPTION 'All five must be flexi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_teachers_substitutions s JOIN konten k ON k.id = s.classroom_teacher_id)
     OR EXISTS (SELECT 1 FROM public.children_classrooms cc JOIN konten k ON k.id = cc.classroom_teacher_id) THEN
    RAISE EXCEPTION 'A substitution or a child is attached to one of them';
  END IF;
END;
$$;

-- Minutes per date and pay per month, before.
CREATE TEMP TABLE day_before ON COMMIT DROP AS
SELECT s.session_date, sum(coalesce(s.minutes_taught, 0)) AS minutes
FROM public.classroom_teachers_attendance_status s JOIN konten k ON k.id = s.classroom_teacher_id
GROUP BY 1;

CREATE TEMP TABLE pay_before ON COMMIT DROP AS
SELECT ct.teacher_id AS employee_id, date_trunc('month', s.session_date) AS month,
       sum(coalesce(s.minutes_taught, 0) / 60.0 * r.hourly_rate) AS pay
FROM public.classroom_teachers_attendance_status s
JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
JOIN public.employee_assignment_rates r ON r.classroom_teacher_id = ct.id
GROUP BY 1, 2;

-- Copies for the rollback.
CREATE TABLE backup.rani_konten_assignments_20261116 AS
SELECT ct.* FROM public.classroom_teachers ct JOIN konten k ON k.id = ct.id;
CREATE TABLE backup.rani_konten_attendances_20261116 AS
SELECT a.* FROM public.classroom_teachers_attendances a JOIN konten k ON k.id = a.classroom_teacher_id;
CREATE TABLE backup.rani_konten_sessions_20261116 AS
SELECT s.* FROM public.classroom_teacher_work_sessions s
JOIN backup.rani_konten_attendances_20261116 a ON a.id = s.attendance_id;
REVOKE ALL ON backup.rani_konten_assignments_20261116, backup.rani_konten_attendances_20261116,
  backup.rani_konten_sessions_20261116 FROM PUBLIC, anon, authenticated;

-- The flexi-session trigger would otherwise read these edits as an admin correction and collapse
-- each day to one session.
SELECT set_config('app.work_sessions_managed', 'on', true);

-- 1. Sessions for the older clock-ins that only have an in/out pair.
SELECT public.materialize_flexi_work_session(a.id)
FROM public.classroom_teachers_attendances a JOIN konten k ON k.id = a.classroom_teacher_id;

-- 2. A day the kept slot never clocked: move that day's earliest other clock-in onto it.
UPDATE public.classroom_teachers_attendances a
SET classroom_teacher_id = (SELECT keep_id FROM konten LIMIT 1)
WHERE a.id IN (
  SELECT DISTINCT ON (a2.session_date) a2.id
  FROM public.classroom_teachers_attendances a2 JOIN konten k ON k.id = a2.classroom_teacher_id
  WHERE k.id <> k.keep_id
    AND NOT EXISTS (
      SELECT 1 FROM public.classroom_teachers_attendances ka
      WHERE ka.classroom_teacher_id = k.keep_id AND ka.session_date = a2.session_date)
  ORDER BY a2.session_date, a2.clocked_in_at NULLS LAST, a2.id
);

-- 3. Every other clock-in hands its sessions to the kept day of the same date, then goes.
UPDATE public.classroom_teacher_work_sessions s
SET attendance_id = ka.id
FROM public.classroom_teachers_attendances a
JOIN konten k ON k.id = a.classroom_teacher_id AND k.id <> k.keep_id
JOIN public.classroom_teachers_attendances ka ON ka.classroom_teacher_id = k.keep_id AND ka.session_date = a.session_date
WHERE s.attendance_id = a.id;

DELETE FROM public.classroom_teachers_attendances a
USING konten k
WHERE k.id = a.classroom_teacher_id AND k.id <> k.keep_id;

-- 4. Each kept day reads as its first start and last finish; open if a session is still running.
UPDATE public.classroom_teachers_attendances a
SET clocked_in_at = x.first_start,
    clocked_out_at = CASE WHEN x.open_sessions > 0 THEN NULL ELSE x.last_end END
FROM (
  SELECT s.attendance_id, min(s.started_at) AS first_start, max(s.ended_at) AS last_end,
         count(*) FILTER (WHERE s.ended_at IS NULL) AS open_sessions
  FROM public.classroom_teacher_work_sessions s
  GROUP BY s.attendance_id
) x
WHERE x.attendance_id = a.id
  AND a.classroom_teacher_id = (SELECT keep_id FROM konten LIMIT 1);

-- 5. The four emptied slots go; the kept one spans the old slots (display only, it is flexi).
DELETE FROM public.classroom_teachers ct USING konten k WHERE ct.id = k.id AND k.id <> k.keep_id;

UPDATE public.classroom_teachers
SET time_start = (SELECT min(time_start) FROM konten), time_end = (SELECT max(time_end) FROM konten)
WHERE id = (SELECT keep_id FROM konten LIMIT 1);

SELECT set_config('app.work_sessions_managed', '', true);

-- ── checks ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n bigint;
  v_keep uuid := (SELECT keep_id FROM konten LIMIT 1);
BEGIN
  IF (SELECT count(*) FROM public.classroom_teachers WHERE id IN (SELECT id FROM konten)) <> 1 THEN
    RAISE EXCEPTION 'Expected one Konten · Bimba assignment left for Miss Rani';
  END IF;

  -- One clock-in per date, as many dates as before.
  IF (SELECT count(*) FROM public.classroom_teachers_attendances WHERE classroom_teacher_id = v_keep)
     <> (SELECT count(*) FROM day_before) THEN
    RAISE EXCEPTION 'Expected one clock-in per date she worked Konten';
  END IF;

  -- The same minutes on every date, give or take the one minute of rounding: each clock-in used to
  -- be rounded on its own (30.4 + 30.4 counted as 60), a merged day is rounded once (61). Seen on
  -- 3 and 6 Nov (418.48 and 446.38 exact minutes, counted 419 and 447 before).
  SELECT count(*) INTO n
  FROM day_before d
  FULL JOIN (
    SELECT session_date, sum(coalesce(minutes_taught, 0)) AS minutes
    FROM public.classroom_teachers_attendance_status WHERE classroom_teacher_id = v_keep GROUP BY 1
  ) a ON a.session_date = d.session_date
  WHERE d.minutes IS NULL OR a.minutes IS NULL OR abs(d.minutes - a.minutes) > 1;
  IF n > 0 THEN RAISE EXCEPTION 'Minutes changed by more than rounding on % dates', n; END IF;

  -- Nobody's pay changed beyond that rounding (a minute at 8,000/h is Rp 133; Miss Rani's
  -- November moves by about Rp 267).
  SELECT count(*) INTO n FROM (
    SELECT 1
    FROM pay_before a
    FULL JOIN (
      SELECT ct.teacher_id AS employee_id, date_trunc('month', s.session_date) AS month,
             sum(coalesce(s.minutes_taught, 0) / 60.0 * r.hourly_rate) AS pay
      FROM public.classroom_teachers_attendance_status s
      JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
      JOIN public.employee_assignment_rates r ON r.classroom_teacher_id = ct.id
      GROUP BY 1, 2
    ) b ON b.employee_id = a.employee_id AND b.month = a.month
    WHERE abs(coalesce(a.pay, 0) - coalesce(b.pay, 0)) > 300
  ) d;
  IF n > 0 THEN RAISE EXCEPTION 'Pay changed by more than rounding for % employee-months', n; END IF;
END;
$$;
