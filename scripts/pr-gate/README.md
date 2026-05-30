# PR Gate

Deterministic GitHub Action that auto-closes PRs that don't follow the project's contribution workflow. Trigger: `pull_request_target: [opened, reopened]`.

## Gate logic (first match wins)

1. **Maintainer bypass** — PR carries the `bypass-pr-check` label → pass. Apply this label and reopen if the gate closed something you wanted through.
2. **Org/repo member bypass** — `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR` → pass.
3. **Approved-work bypass** — PR body links an issue (via `Closes #N` / `Fixes #N` / `Resolves #N`) that carries the `approved` label, and the PR author is in the issue's assignees → pass.
4. **Small-fix bypass** — `additions + deletions ≤ 50` → pass + apply `small-fix` label.
5. **Otherwise** — apply `auto-closed-needs-issue` label, post rejection comment, close.

## Local testing

```bash
cd scripts/pr-gate
npm install
export GITHUB_TOKEN=ghp_... # PAT with repo scope
npx tsx index.ts --pr 1234  # always dry-run unless --no-dry-run
```

The CLI prints the decision and exits without touching the PR.

## Toggling dry-run in production

1. Go to repo **Settings → Secrets and variables → Actions → Variables**.
2. Edit `PR_GATE_DRY_RUN`.
3. Set to `false` to make the Action take real action; any other value (or unset) keeps it in dry-run mode.

The default is `true` — the gate logs decisions but does not act until the maintainer flips the variable.

## Tweaking rules

- Thresholds, labels, comment text → [config.ts](./config.ts)
- Rule logic (pure functions) → [rules.ts](./rules.ts)
- GitHub API calls → [github.ts](./github.ts)
- Orchestration → [index.ts](./index.ts)

## Known limitations

- Runs only on PR open/reopen — not on `synchronize`. A PR that grows past 50 lines after being passed will not be re-gated.
- Cross-repo issue references (`owner/repo#N`) are not honored.
- No LLM is called. This Action is fully deterministic.
