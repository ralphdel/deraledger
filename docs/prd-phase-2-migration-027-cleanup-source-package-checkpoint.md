# Migration 027 approval RPC diagnostic-cleanup source package

Migration `027` prepares a source-only replacement of the existing reviewed-profile approval RPC at the unchanged 13-input signature. It removes local rehearsal diagnostics from the RPC body while retaining the approved decision, idempotency, row-version, transaction, and service-role security behavior.

The package contains the migration, a staging preflight that requires the Migration 026 RPC and its security posture, and a postflight that verifies the cleaned body has none of the former local diagnostic markers. No database has been contacted or changed.

The initial local rehearsal showed the former `information_schema.routine_privileges` exclusive-grantee assertion can count owner/grant metadata as if it were an additional execute grantee. Migration 027 verification now proves the exact effective `service_role` execute privilege, denies effective `anon` and `authenticated` execution, and inspects the function ACL directly for the PUBLIC pseudo-role.

The local rehearsal harness is updated to apply Migration 027 after Migration 026 and retain only external probes plus the 29 behavior scenarios. Staging and production application remain separate user-controlled steps after local rehearsal and independent review.
