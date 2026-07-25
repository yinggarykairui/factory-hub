# SECRETS.md — registry of key **names only** (§12): what each key is for and which build types may reference it; values never appear here or in any model context — they live only in GitHub Actions secrets and the owner's local `.env`.

| Key name | Purpose | Allowed build types |
|----------|---------|---------------------|
| `FACTORY_PAT` | Fine-grained GitHub PAT, factory repos only (§15); powers all hub/repo/issue/Pages API calls | all (infrastructure, not build-facing) |

**PAT expiry: 2026-10-23.** Appendix C watch: the retro checks PAT age
monthly and files a `blocked` issue one week before expiry — so a `blocked`
issue must exist by **2026-10-16** if the token hasn't been rotated. Value
lives in the owner's local env file (`~/.factory.env`), never in any repo
or model context (§12).
