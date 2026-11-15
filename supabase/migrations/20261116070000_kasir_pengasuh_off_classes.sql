-- Phase 3d of the employee work refactor: Miss Manda (Kasir) and Miss Ima (Pengasuh) stop being
-- recorded as teachers of Rumah Kecil classes.
--
-- Each was put on Kelas Rumah Kecil 08.00, 10.00 and Kelas Khusus Rumah Kecil 15.30 only so they
-- could clock in; no child was ever placed with them there and nobody ever substituted for them.
-- With the owner's rates confirmed (Kasir 8,000 and Caregiving 8,000, the same as those classes),
-- moving them changes no one's pay. The work items are checked to be Rucil and paying 8,000:
--
--   * Miss Manda's 3 class assignments become Front Office · Rucil (the Kasir work item, renamed
--     in Kelola Item Kerja), keeping their times;
--   * Miss Ima's RK 10.00 and Khusus 15.30 become Caregiving · Rucil, keeping their times;
--   * Miss Ima's RK 08.00 was never worked (0 clock-ins) and is removed.
--
-- The two work items are pinned by id, not by name, since names can be edited in Kelola Item Kerja
-- (Kasir was renamed Front Office). Pinned to the 6 assignment ids, not to roles: Miss Tiara is also a Pengasuh but really teaches
-- those classes, and stays. The ids keep their clock-ins (36). What each assignment was, including
-- the removed one, is kept in backup.kasir_pengasuh_moves_20261116 for the rollback. Evidence of
-- their pay before the move: docs/kasir_pengasuh_class_clockins.csv.
--
-- Rollback: supabase/rollbacks/20261116070000_kasir_pengasuh_off_classes.sql

CREATE TEMP TABLE status_before ON COMMIT DROP AS
SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
FROM public.classroom_teachers_attendance_status;

CREATE TEMP TABLE pay_before ON COMMIT DROP AS
SELECT ct.teacher_id AS employee_id, date_trunc('month', s.session_date) AS month,
       sum(coalesce(s.minutes_taught, 0) / 60.0 * r.hourly_rate) AS pay
FROM public.classroom_teachers_attendance_status s
JOIN public.classroom_teachers ct ON ct.id = s.classroom_teacher_id
JOIN public.employee_assignment_rates r ON r.classroom_teacher_id = ct.id
GROUP BY 1, 2;

CREATE TEMP TABLE moves (classroom_teacher_id uuid PRIMARY KEY, employee_id uuid, work_item_id uuid, remove boolean)
ON COMMIT DROP;
INSERT INTO moves VALUES
  ('a57707b6-7db4-486f-9d5b-4ad163c99593', '1ee33e37-d691-4676-9d47-b9fb75a36640', '2993a419-a1d9-4391-9199-82c992aeb757', false), -- Manda RK 08.00
  ('1120802b-bea5-4e46-bff0-00c87c22d7b5', '1ee33e37-d691-4676-9d47-b9fb75a36640', '2993a419-a1d9-4391-9199-82c992aeb757', false), -- Manda RK 10.00
  ('f92716f3-de7b-4aeb-bd50-60d4be61fe57', '1ee33e37-d691-4676-9d47-b9fb75a36640', '2993a419-a1d9-4391-9199-82c992aeb757', false), -- Manda Khusus 15.30
  ('971081d8-036b-45c1-b5b6-a921eee19c19', '6367f9b2-55f7-4f3d-b4b3-58f35ebabb04', '0523051e-14df-4f3f-8cfe-128d8462b797', false), -- Ima RK 10.00
  ('2c9bf81f-8299-4077-94b0-5e63a70089ee', '6367f9b2-55f7-4f3d-b4b3-58f35ebabb04', '0523051e-14df-4f3f-8cfe-128d8462b797', false), -- Ima Khusus 15.30
  ('a738d431-5c7f-40f8-8ec2-41bcf16b2baa', '6367f9b2-55f7-4f3d-b4b3-58f35ebabb04', NULL,                                   true);  -- Ima RK 08.00, never worked

-- Preconditions: exactly these 6, still on billable classes, belonging to the right people, with
-- no children and no substitutions; the one being removed has no clock-ins.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.classroom_teachers ct JOIN moves m ON m.classroom_teacher_id = ct.id
      JOIN public.classrooms c ON c.id = ct.classroom_id
      WHERE ct.teacher_id = m.employee_id AND c.is_billable AND ct.work_item_id IS NULL) <> 6 THEN
    RAISE EXCEPTION 'The 6 Kasir/Pengasuh class assignments are not as expected';
  END IF;
  IF (SELECT count(*) FROM public.work_items w JOIN public.office_branch b ON b.id = w.branch_id
      WHERE w.id IN (SELECT work_item_id FROM moves) AND b.name = 'Rumah Main Rumah Kecil (Rucil)'
        AND w.hourly_rate = 8000 AND w.active) <> 2 THEN
    RAISE EXCEPTION 'Front Office and Caregiving must be active Rucil work items paying 8,000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.children_classrooms cc JOIN moves m ON m.classroom_teacher_id = cc.classroom_teacher_id) THEN
    RAISE EXCEPTION 'A child has been placed on one of these assignments';
  END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_teachers_substitutions s JOIN moves m ON m.classroom_teacher_id = s.classroom_teacher_id) THEN
    RAISE EXCEPTION 'One of these assignments has a substitution';
  END IF;
  IF EXISTS (SELECT 1 FROM public.classroom_teachers_attendances a JOIN moves m ON m.classroom_teacher_id = a.classroom_teacher_id
             WHERE m.remove) THEN
    RAISE EXCEPTION 'The assignment to remove has clock-ins';
  END IF;
END;
$$;

-- What each was, for the rollback.
CREATE TABLE backup.kasir_pengasuh_moves_20261116 AS
SELECT ct.*, m.remove AS removed
FROM public.classroom_teachers ct JOIN moves m ON m.classroom_teacher_id = ct.id;
REVOKE ALL ON backup.kasir_pengasuh_moves_20261116 FROM PUBLIC, anon, authenticated;

DELETE FROM public.classroom_teachers ct USING moves m
WHERE m.classroom_teacher_id = ct.id AND m.remove;

UPDATE public.classroom_teachers ct
SET work_item_id = w.id,
    time_start = c.time_start,
    time_end = c.time_end,
    is_flexi_hours = c.is_flexi_hours,
    classroom_id = NULL
FROM moves m, public.classrooms c, public.work_items w
WHERE m.classroom_teacher_id = ct.id AND NOT m.remove
  AND c.id = ct.classroom_id
  AND w.id = m.work_item_id;

-- ── checks ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n bigint;
BEGIN
  IF (SELECT count(*) FROM public.classroom_teachers ct JOIN moves m ON m.classroom_teacher_id = ct.id
      WHERE NOT m.remove AND ct.classroom_id IS NULL AND ct.work_item_id IS NOT NULL) <> 5 THEN
    RAISE EXCEPTION 'Expected 5 assignments moved to a work item';
  END IF;
  IF (SELECT count(*) FROM public.classroom_teachers) <> 78 THEN
    RAISE EXCEPTION 'Expected 78 assignments (79 minus the removed one), got %', (SELECT count(*) FROM public.classroom_teachers);
  END IF;

  SELECT count(*) INTO n FROM (
    (SELECT * FROM status_before
     EXCEPT
     SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
     FROM public.classroom_teachers_attendance_status)
    UNION ALL
    (SELECT id, scheduled_start, scheduled_end, minutes_taught, arrival_status, departure_status, work_session_count
     FROM public.classroom_teachers_attendance_status
     EXCEPT
     SELECT * FROM status_before)
  ) d;
  IF n > 0 THEN RAISE EXCEPTION 'Attendance status changed for % rows', n; END IF;

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
    WHERE round(coalesce(a.pay, 0), 2) <> round(coalesce(b.pay, 0), 2)
  ) d;
  IF n > 0 THEN RAISE EXCEPTION 'Pay changed for % employee-months', n; END IF;
END;
$$;
