-- DeraLedger — Fix references.handled_by column type
-- The handled_by column was incorrectly typed as UUID.
-- It should store a plain text name (team member's display name).

ALTER TABLE "references" DROP CONSTRAINT IF EXISTS references_handled_by_fkey;
ALTER TABLE "references" ALTER COLUMN handled_by TYPE TEXT USING handled_by::TEXT;
