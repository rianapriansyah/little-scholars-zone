-- Hapus Absensi & Laporan: one admin action that removes a reported day and its daily report.
--
-- A reported day is held at Hadir and cannot be deleted while its report exists
-- (children_daily_reports_attendance_fkey, 20261108030000), so the admin had to Hapus Laporan and
-- then Hapus Absensi as two steps. This does both in one transaction: the report goes first, then
-- delete_child_attendance removes the day and hands it back to the period's quota. If either step
-- is refused, neither happens — a report is never deleted with its day left behind, or the reverse.
--
-- Additive only: one new function, no data touched by the migration itself.

CREATE OR REPLACE FUNCTION public.delete_child_attendance_with_report(p_attendance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- IS DISTINCT FROM, not <>: with no role claim the comparison is NULL, which an IF treats as
  -- false and would wave the caller through.
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Hanya admin yang dapat menghapus absensi dan laporan harian';
  END IF;

  -- At most one row (children_daily_reports_child_attendance_id_key); daily_report_items cascades.
  -- No report is fine: then this is just Hapus Absensi.
  DELETE FROM public.children_daily_reports WHERE child_attendance_id = p_attendance_id;

  -- Same day-removal and quota/closure rule as Hapus Absensi.
  PERFORM public.delete_child_attendance(p_attendance_id);
END;
$$;

COMMENT ON FUNCTION public.delete_child_attendance_with_report(uuid) IS
  'Admin only. Deletes an attendance day together with its daily report (if any) in one '
  'transaction, returning the day to the learning period''s quota as delete_child_attendance does.';

REVOKE EXECUTE ON FUNCTION public.delete_child_attendance_with_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_child_attendance_with_report(uuid) TO authenticated, service_role;
