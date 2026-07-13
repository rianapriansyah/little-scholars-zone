-- contact_email was nullable, backed only by a partial unique index. That partial index
-- can't be used as an ON CONFLICT (contact_email) arbiter, which silently broke the
-- upsert-by-email step in create-family-account (Postgres error 42P10, swallowed as
-- non-fatal) — families rows were never created even though the Auth account was.
-- Every family is created through that flow and the form already requires an email, so
-- make it a real NOT NULL + UNIQUE column, matching teachers.email.

DROP INDEX IF EXISTS public.families_contact_email_idx;
ALTER TABLE public.families ALTER COLUMN contact_email SET NOT NULL;
ALTER TABLE public.families ADD CONSTRAINT families_contact_email_key UNIQUE (contact_email);
