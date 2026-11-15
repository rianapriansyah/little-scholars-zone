-- Rollback for 20261116080000_merge_rani_konten.sql: Miss Rani's five Konten · Bimba assignments,
-- their clock-ins and sessions come back exactly as they were, from the backup schema.
--
-- Refuses if she has clocked in on Konten · Bimba since the merge: that day exists only on the
-- merged assignment and would be lost; handle it by hand first.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261116080000_merge_rani_konten.sql

BEGIN;

DO $$
DECLARE
  v_keep uuid := (SELECT id FROM backup.rani_konten_assignments_20261116 ORDER BY time_start, id LIMIT 1);
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.classroom_teachers_attendances a
    WHERE a.classroom_teacher_id = v_keep
      AND a.session_date NOT IN (SELECT session_date FROM backup.rani_konten_attendances_20261116)
  ) THEN
    RAISE EXCEPTION 'Miss Rani has clocked in on Konten · Bimba since the merge; resolve by hand';
  END IF;
END;
$$;

-- Written back exactly as they were: triggers would re-normalise times or collapse sessions.
SET LOCAL session_replication_role = replica;

-- Sessions first, explicitly: with session_replication_role = replica the ON DELETE CASCADE from
-- the attendance does not fire, so they would otherwise be left behind.
DELETE FROM public.classroom_teacher_work_sessions
WHERE attendance_id IN (
  SELECT id FROM public.classroom_teachers_attendances
  WHERE classroom_teacher_id IN (SELECT id FROM backup.rani_konten_assignments_20261116)
);

DELETE FROM public.classroom_teachers_attendances
WHERE classroom_teacher_id IN (SELECT id FROM backup.rani_konten_assignments_20261116);

INSERT INTO public.classroom_teachers SELECT * FROM backup.rani_konten_assignments_20261116
ON CONFLICT (id) DO UPDATE SET time_start = EXCLUDED.time_start, time_end = EXCLUDED.time_end;

INSERT INTO public.classroom_teachers_attendances SELECT * FROM backup.rani_konten_attendances_20261116;
INSERT INTO public.classroom_teacher_work_sessions SELECT * FROM backup.rani_konten_sessions_20261116;

DROP TABLE backup.rani_konten_sessions_20261116;
DROP TABLE backup.rani_konten_attendances_20261116;
DROP TABLE backup.rani_konten_assignments_20261116;

COMMIT;
