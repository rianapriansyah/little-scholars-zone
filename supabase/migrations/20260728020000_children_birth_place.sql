-- Children get a place-of-birth field alongside birthdate.
ALTER TABLE public.children ADD COLUMN birth_place text;
