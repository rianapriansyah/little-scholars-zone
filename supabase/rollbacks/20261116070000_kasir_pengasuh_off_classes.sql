-- Rollback for 20261116070000_kasir_pengasuh_off_classes.sql: Miss Manda's and Miss Ima's
-- assignments go back on their Rumah Kecil classes exactly as they were, and Miss Ima's unused
-- RK 08.00 assignment is restored, all from backup.kasir_pengasuh_moves_20261116.
--
-- Run: npx supabase db query --linked --yes -f supabase/rollbacks/20261116070000_kasir_pengasuh_off_classes.sql

BEGIN;

UPDATE public.classroom_teachers ct
SET classroom_id = b.classroom_id,
    work_item_id = b.work_item_id,
    time_start = b.time_start,
    time_end = b.time_end,
    is_flexi_hours = b.is_flexi_hours
FROM backup.kasir_pengasuh_moves_20261116 b
WHERE b.id = ct.id AND NOT b.removed;

INSERT INTO public.classroom_teachers (id, classroom_id, teacher_id, created_at, work_item_id, time_start, time_end, is_flexi_hours)
SELECT id, classroom_id, teacher_id, created_at, work_item_id, time_start, time_end, is_flexi_hours
FROM backup.kasir_pengasuh_moves_20261116
WHERE removed;

DROP TABLE backup.kasir_pengasuh_moves_20261116;

COMMIT;
