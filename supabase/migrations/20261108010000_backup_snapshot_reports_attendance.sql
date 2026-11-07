-- A rollback point before the report <-> absensi fix (20261108020000, 20261108030000).
--
-- The project is on the free plan, which has no restorable backups, and this fix changes the
-- foreign keys around child_attendances. Periods #1 and #2 of one child have already been lost
-- once to a cascade (see 20261108020000), so before touching those keys again the four tables
-- involved are copied as they stand.
--
-- The copies live in their own `backup` schema, which PostgREST does not expose, and every
-- grant to the API roles is revoked on top of that: these rows include family data and must
-- never be readable through the app. They are plain copies (no keys, no RLS, no triggers) and
-- nothing reads them. Drop them by hand only once the fix has proven itself.

CREATE SCHEMA IF NOT EXISTS backup;

REVOKE ALL ON SCHEMA backup FROM PUBLIC, anon, authenticated;

CREATE TABLE backup.child_attendances_20261108 AS TABLE public.child_attendances;
CREATE TABLE backup.children_daily_reports_20261108 AS TABLE public.children_daily_reports;
CREATE TABLE backup.learning_periods_20261108 AS TABLE public.learning_periods;
CREATE TABLE backup.payment_periods_20261108 AS TABLE public.payment_periods;

REVOKE ALL ON ALL TABLES IN SCHEMA backup FROM PUBLIC, anon, authenticated;

COMMENT ON SCHEMA backup IS
  'Point-in-time copies taken before risky migrations. Not exposed through the API. Nothing reads '
  'these tables; they exist only so a bad migration can be undone by hand.';

DO $$
BEGIN
  IF (SELECT count(*) FROM backup.child_attendances_20261108) <> (SELECT count(*) FROM public.child_attendances)
     OR (SELECT count(*) FROM backup.children_daily_reports_20261108) <> (SELECT count(*) FROM public.children_daily_reports)
     OR (SELECT count(*) FROM backup.learning_periods_20261108) <> (SELECT count(*) FROM public.learning_periods)
     OR (SELECT count(*) FROM backup.payment_periods_20261108) <> (SELECT count(*) FROM public.payment_periods)
  THEN
    RAISE EXCEPTION 'Snapshot row counts do not match the live tables';
  END IF;
END;
$$;
