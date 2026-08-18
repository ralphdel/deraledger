## Mandatory Database-Script Reading

Before creating or modifying any SQL migration, database inspection query, rollback/rehearsal runner, PowerShell PostgreSQL script, psql parser, schema fingerprint, or credentialed database command, read:

1. `docs/database-migration-and-staging-safety-runbook.md`
2. `docs/sql-migration-rehearsal-lessons-learned.md`

Agents must not generate or run database scripts until they have reviewed the confirmed incident ledger and mandatory checklists in those files.

Known failures documented there must receive regression coverage rather than being rediscovered through staging or production execution.
