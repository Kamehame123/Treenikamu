# Project instructions

## Commit and push completed updates

- After every completed, verified update, commit the task-related changes and
  push the current branch to its configured remote.
- Do not wait for a separate request to commit or push. Before reporting an
  update as complete, verify that the remote branch contains the new commit.
- Preserve unrelated local changes. Do not force-push or amend existing commits.
- If committing or pushing is blocked, report the blocker explicitly rather than
  treating the update as delivered.

## Preserve existing users' data

- For every app change, assess and protect existing users' accumulated training
  records, history, logs, imported data, and the relationships and metadata needed
  to keep that data usable. Data preservation is a release requirement, not an
  optional follow-up.
- Before changing persistence, schemas, storage keys, data formats, user identity,
  or deployment/storage locations, identify how existing data will remain
  accessible. Never clear, reset, silently overwrite, or discard existing user
  data to make a change work.
- When a data model or storage system changes, provide an automated migration
  from the existing browser-held data wherever possible. Do not assume users
  have backups, prior exports, cloud copies, or the original import files.
  Existing browser data must be sufficient to migrate to the changed system.
- Make migrations non-destructive and safe to retry or resume without losing or
  duplicating records. Keep the original data recoverable until the migrated
  data has been validated and successfully persisted. A failed migration must
  not replace existing data with an empty or partially migrated state.
- Surface migration failures clearly and provide an actionable recovery path
  using the retained browser data. Never silently treat unreadable or
  incompatible saved data as a new, empty user account.
- Automate migration and recovery as much as possible. If user action is
  unavoidable, provide clear, step-by-step instructions before the affected
  upgrade or destructive step, with in-app guidance where applicable. Do not
  make a pre-existing user backup a prerequisite.
- Validate affected upgrades with representative data from previously supported
  formats, including training/history/log/import preservation, interrupted or
  failed migrations, and retries. Update migration documentation with the
  behavior. If existing data cannot be preserved or recovered from the browser,
  stop and report the blocker rather than ship a data-losing change.
- Every commit that changes app files must also bump `VERSION` in `sw.js`
  (increment by one), otherwise installed devices keep serving cached old files.
