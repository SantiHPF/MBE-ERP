-- A phone and an email for the place itself.
--
-- Until now the only phone number or address in the CRM belonged to a
-- CrmContact -- a named person inside a university. That covers the useful
-- case (ring Marta in the internships office) and misses the ordinary one:
-- the switchboard, and the info@ address you write to before you know
-- anybody, or after the person you knew has left.
--
-- Both stay nullable. Plenty of sources will only ever have people, and a
-- job portal usually has neither.

ALTER TABLE "CrmSource" ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT;
