-- Rollback for 20261118030000_attendance_status_security_invoker.sql.
--
-- WARNING: this re-opens the leak that migration closed (logged-in users, parents included, can
-- read other employees' clock-ins through the view). Only run it if the option itself breaks a
-- screen, and fix forward as soon as possible.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261118030000_attendance_status_security_invoker.sql

BEGIN;

ALTER VIEW public.employee_attendance_status RESET (security_invoker);

COMMIT;
