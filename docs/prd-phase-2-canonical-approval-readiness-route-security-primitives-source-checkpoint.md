# Canonical approval readiness route security primitives - source checkpoint

This package is source-only. It creates no route, admin API, UI, runtime wiring, database connection, or readiness-service factory instance.

It provides bounded raw JSON scanning with duplicate decoded-key rejection before object construction, strict issue/snapshot validation, fail-closed CSRF and throttle seams with runtime-normalized dependency results, exact origin helpers, allowlisted response envelopes, and redacted operational-event inputs. Unknown or malformed response, CSRF, and throttle outcomes fail closed without exposing arbitrary diagnostic codes.

The primitives never establish reviewer authority. A future route must use the reviewed zero-argument service-factory path, whose resolver accepts only server-read `app_metadata.is_super_admin`; `user_metadata` is not authority. CSRF token lifecycle and durable throttling remain separately configured future work, and their unconfigured defaults deny safely.

Future RBAC remains deferred. There is no approval execution, activation, collection unlock, or commercial behavior in this package.

Safe next step: independent source review before any route implementation or runtime adoption.
