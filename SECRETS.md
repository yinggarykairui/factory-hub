# SECRETS.md — registry of key **names only** (§12): what each key is for and which build types may reference it; values never appear here or in any model context — they live only in GitHub Actions secrets and the owner's local `.env`.

| Key name | Purpose | Allowed build types |
|----------|---------|---------------------|
| `FACTORY_PAT` | Fine-grained GitHub PAT used **only** by the `mirror-builds` Action (§4, meta #135) to create and sync project repos and enable Pages. Needs Administration (write), Contents (write) and Pages (write) on **all repositories** — a token limited to selected repos cannot create one. | all (infrastructure, not build-facing) |

Registered as an Actions secret in factory-hub (set 2026-09-22). It is never
placed in a routine prompt, a task, or any model context: a token in a prompt
lands in every run log, which is how the 2026-08-03 trigger pair leaked one
(scrubbed and disabled 2026-10-08). Cloud shifts authenticate through the
Claude GitHub App on the repos attached to the routine, not through this key.

**Rotation.** Fine-grained PATs expire; the previous one died ~2026-09-21 and
took the factory down for 18 days. When rotating: create the new token, update
the Actions secret, re-run `mirror-builds` once with `workflow_dispatch` to
prove it. Appendix C's credential-expiry watch still applies — a `blocked`
issue one week before expiry.
