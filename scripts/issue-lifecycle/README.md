# Issue Lifecycle

Deterministic GitHub Actions that enforce OpenFront's issue lifecycle. No LLM calls — only the default `GITHUB_TOKEN`.

## Rules

1. **Stale closer** — daily cron. Unmilestoned issues get a warning at 7 days of inactivity, are closed at 14. Exempt: milestoned or `keep-open`-labelled issues. Assignees are not an exemption — if an unmilestoned issue somehow has assignees (event drift), Rule 2 unassigns them and Rule 1 still applies.
2. **Assignment invariant** — event + cron. You cannot assign a person to an unmilestoned issue. Violators are unassigned automatically.
3. **Approval label sync** — event + cron. `not-approved` and `approved` track milestone state (none = `not-approved`, any milestone = `approved`).

See the parent spec for the full contribution model rationale.

## Triggers

- [issue-lifecycle-cron.yml](../../.github/workflows/issue-lifecycle-cron.yml) — daily at 06:00 UTC, plus `workflow_dispatch`.
- [issue-lifecycle-events.yml](../../.github/workflows/issue-lifecycle-events.yml) — `issues: [opened, assigned, milestoned, demilestoned]`.

## Local testing

```bash
cd scripts/issue-lifecycle
npm install
export GITHUB_TOKEN=ghp_... # PAT with repo scope

# Full cron sweep against the real repo, dry-run (default for CLI):
npx tsx index.ts --mode cron

# Single-issue event-mode dry-run (simulates the assigned event):
EVENT_NAME=assigned npx tsx index.ts --mode event --issue 1234

# Force live mode locally (BE CAREFUL — this will mutate the repo):
npx tsx index.ts --mode cron --no-dry-run
```

CLI invocations are dry-run by default. Pass `--no-dry-run` to apply.

## Toggling dry-run in production

1. Go to repo **Settings → Secrets and variables → Actions → Variables**.
2. Edit `ISSUE_LIFECYCLE_DRY_RUN`.
3. Set to `false` to make the Actions act for real; any other value (or unset) keeps them in dry-run mode.

The default is `true` — both workflows log decisions but do not act until the maintainer flips the variable.

## File layout

- [config.ts](./config.ts) — constants, labels, comment templates
- [github.ts](./github.ts) — Octokit wrapper, action applier, label idempotent-creation
- [rules/approval-label-sync.ts](./rules/approval-label-sync.ts) — Rule 3 (pure function)
- [rules/assignment-invariant.ts](./rules/assignment-invariant.ts) — Rule 2 (pure function)
- [rules/stale-closer.ts](./rules/stale-closer.ts) — Rule 1 (async; reads comment history)
- [cron.ts](./cron.ts) — daily sweep orchestrator
- [events.ts](./events.ts) — event-mode dispatcher
- [index.ts](./index.ts) — entrypoint, arg parser

## Notes

- Labels are auto-created on every run (idempotent). The maintainer does not need to manually pre-create any of them.
- Rules act only on issues — PRs are filtered out (`pull_request` field check).
- API rate limit during the cron sweep causes the run to exit non-zero; the next day's cron retries.
- No Claude / LLM calls. Layer B will layer triage on top of this foundation.
