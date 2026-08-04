-- Short name a teacher is actually addressed by (e.g. "Bu Reski" for "Rezeki Ramadhani"),
-- separate from full_name, which stays the formal record.
--
-- Nullable and unset: entries are filled in by hand. Anything displaying it should fall back
-- to full_name so a teacher without one is never greeted by a blank.
ALTER TABLE public.teachers ADD COLUMN call_name text;

COMMENT ON COLUMN public.teachers.call_name IS
  'Optional short/informal name for greetings and headings. Falls back to full_name when '
  'not set. Not unique — two teachers may share a call name.';
