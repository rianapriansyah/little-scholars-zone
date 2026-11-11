-- 20261109050000 renamed child_attendances_* / learning_periods_* constraints, but its function
-- rewrite matched the old table names with \m...\M. `_` is a word character, so
-- `child_attendances_child_classroom_date_key` never matched and record_attendance kept
--   ON CONFLICT ON CONSTRAINT child_attendances_child_classroom_date_key
-- which now fails with "constraint ... does not exist" on every attendance save. The rename's
-- leftover check used the same pattern, so it passed.
--
-- Re-create every public function that still names an old-prefixed object. The lookahead keeps
-- the backup snapshot tables (backup.child_attendances_20261109 etc.) out of it, and the leading
-- non-identifier character keeps move_child_attendances / delete_learning_period untouched.

BEGIN;

DO $$
DECLARE
  r   record;
  def text;
  n   int := 0;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prosrc ~ '(^|[^a-z0-9_])(child_attendances|learning_periods)_(?=[a-z])'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '(^|[^a-z0-9_])child_attendances_(?=[a-z])', '\1children_attendances_', 'g');
    def := regexp_replace(def, '(^|[^a-z0-9_])learning_periods_(?=[a-z])',  '\1children_learning_periods_', 'g');
    EXECUTE def;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'rewrote % functions', n;
END $$;

DO $$
DECLARE
  leftovers text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO leftovers
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.prosrc ~ '(^|[^a-z0-9_])(child_attendances|learning_periods)_(?=[a-z])';
  IF leftovers IS NOT NULL THEN
    RAISE EXCEPTION 'functions still naming an old-prefixed object: %', leftovers;
  END IF;

  IF pg_get_functiondef('public.record_attendance(uuid,uuid,date,text,text,uuid)'::regprocedure)
     !~ 'ON CONFLICT ON CONSTRAINT children_attendances_child_classroom_date_key' THEN
    RAISE EXCEPTION 'record_attendance does not use children_attendances_child_classroom_date_key';
  END IF;
END $$;

COMMIT;
