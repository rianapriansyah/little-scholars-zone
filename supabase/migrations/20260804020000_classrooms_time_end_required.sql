-- time_end was nullable only because the column postdates the original classrooms
-- (20260713233639_classroom_multi_day_and_end_time.sql added it to existing rows).
--
-- Everything downstream now needs it: getClassStatus() cannot tell that a class has finished
-- without an end time, so a classroom created without one would sit on the teacher's home
-- screen reading "Kelas sedang berjalan" for the rest of the day.
--
-- Safe to enforce: all 10 existing rows have an end time, and both the create and edit paths
-- go through ClassroomDetailEditForm, which already requires it.
ALTER TABLE public.classrooms ALTER COLUMN time_end SET NOT NULL;

-- Mirrors the validation ClassroomDetailEditForm already applies ("Waktu selesai harus setelah
-- waktu mulai"), so this rejects nothing the UI would have accepted. It stops a class that
-- ends before it starts — which would read as finished the moment it was created — from being
-- introduced through the API or a direct SQL write.
ALTER TABLE public.classrooms
  ADD CONSTRAINT classrooms_time_end_after_start CHECK (time_end > time_start);

COMMENT ON COLUMN public.classrooms.time_end IS
  'Required. The teacher home screen derives "Kelas selesai" from this; without it a class '
  'never stops looking in progress. Must be later than time_start — classes do not cross '
  'midnight.';
