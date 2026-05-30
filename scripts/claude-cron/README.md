# Claude Triage & Daily Digest

Daily cron that uses Claude (Anthropic API) to triage incoming GitHub issues and produce a maintainer digest. Builds on top of [Issue Lifecycle (Layer A)](../issue-lifecycle/README.md), which it never overrides.

## What it does

Once a day, [the workflow](../../.github/workflows/claude-cron.yml) runs two passes:

1. **Pass 1 — Triage.** For each open issue without the `claude-triaged` label (and not authored by an org member), Claude classifies the issue. Bugs and small QoL improvements get labelled; out-of-scope reports (feature requests, support questions, billing, security, translation) get auto-closed with a redirect comment.
2. **Pass 2 — Digest.** Claude reviews every open PR awaiting maintainer review, then composes a markdown digest of what needs your attention. The digest gets posted as a comment on a pinned tracking issue, and optionally to a Discord webhook.

Both passes default to dry-run.

## Rules and guarantees

- **Idempotent.** Once an issue has the `claude-triaged` label, it is never re-processed.
- **Conservative.** Auto-close decisions require `confidence: high` from Claude. Anything else stays open with `claude-uncertain`.
- **Advisor-only on duplicates.** Suspected duplicates get `possible-duplicate` and a comment — never auto-closed.
- **Hands off Layer A.** Adding or removing labels in `FORBIDDEN_LABELS` (`approved`, `not-approved`, `stale`, `keep-open`, `auto-closed-stale`) throws at runtime.
- **No milestones, no assignments, no reopens.** Claude can't take these actions.

## Triggers

- [`claude-cron.yml`](../../.github/workflows/claude-cron.yml) — daily at 06:00 UTC, plus `workflow_dispatch`.

## Local testing

```bash
cd scripts/claude-cron
npm install --no-audit --no-fund --ignore-scripts

export GITHUB_TOKEN=ghp_...         # PAT with repo scope (issues:write)
export ANTHROPIC_API_KEY=sk-ant-... # from console.anthropic.com

# Triage a single issue and print the decision (no apply):
npx tsx index.ts --issue 1234

# Run the full daily sweep in dry-run (logs everything, applies nothing):
npx tsx index.ts

# Run the full sweep for real (BE CAREFUL — this mutates the repo and posts a digest):
npx tsx index.ts --no-dry-run
```

CLI invocations (anything with `--issue` or `--dry-run` / `--no-dry-run`) default to dry-run unless `--no-dry-run` is given explicitly. Cron invocations (no CLI flags) read `DRY_RUN` from env.

Run unit tests from the repo root:

```bash
npx vitest run --dir scripts/claude-cron/tests
```

## Toggling dry-run in production

1. Go to repo **Settings → Secrets and variables → Actions → Variables**.
2. Set `CLAUDE_CRON_DRY_RUN`.
3. Set to `false` to act for real; any other value (or unset) keeps it in dry-run mode.

The default is `true`.

## Pre-launch checklist

Before flipping `CLAUDE_CRON_DRY_RUN` to `false`, the maintainer should:

- [ ] Set `ANTHROPIC_API_KEY` as a repo secret.
- [ ] Fill in the TODO constants in [`config.ts`](./config.ts):
  - `URLS.GAME_DISCORD`
  - `URLS.SECURITY_EMAIL` (or publish a `SECURITY.md` and link it)
  - Decide on `ENABLE_TRANSLATION_CLOSE` (default `true`)
- [ ] Create a tracking issue for the digest, pin it, and set `DIGEST_ISSUE_NUMBER` in `config.ts`. Until set, the digest is logged to stdout instead of posted.
- [ ] _(Optional)_ Set `DISCORD_WEBHOOK_URL` as a repo secret if Discord posting is desired.
- [ ] Watch dry-run logs in Actions output for at least one week. Verify:
  - Classification looks reasonable for the actual issues received.
  - Auto-close decisions are ones you'd agree with.
  - The digest format is useful.
  - Token usage is in the expected range (logged per call).
- [ ] Tune the triage system prompt in [`claude.ts`](./claude.ts) based on observed misclassifications.
- [ ] Flip `CLAUDE_CRON_DRY_RUN` repo variable to `'false'`.

## File layout

- [`index.ts`](./index.ts) — entrypoint and CLI arg parsing
- [`config.ts`](./config.ts) — constants, labels, comment templates, forbidden-label list
- [`github.ts`](./github.ts) — Octokit wrapper, label idempotency, forbidden-label guard
- [`claude.ts`](./claude.ts) — Anthropic SDK wrapper, system prompts, tool schemas
- [`pass1-triage.ts`](./pass1-triage.ts) — Pass 1: triage logic, confidence threshold enforcement
- [`pr-reviewer.ts`](./pr-reviewer.ts) — Phase 2a: per-PR Claude review for the digest
- [`pass2-digest.ts`](./pass2-digest.ts) — Pass 2 orchestrator: assembles inputs, calls Claude, posts
- [`digest-formatter.ts`](./digest-formatter.ts) — input shaping + deterministic fallback markdown
- [`discord.ts`](./discord.ts) — optional Discord webhook poster

## Cost notes

The system prompts and tool schemas are designed so each call is small (~1–3k input tokens, <500 output). Triage runs once per new outside-author issue (~3–10/day in steady state); PR review runs once per non-draft open PR awaiting review. A daily run typically uses 10–20 Claude calls. Hard cap is `MAX_CALLS_PER_RUN = 100`.

Token usage is logged per call (`tokens in=X out=Y`); grep for it in workflow output to diagnose cost spikes.

## Editing the prompts

The triage system prompt is the highest-leverage knob. It lives in [`claude.ts`](./claude.ts) as `TRIAGE_SYSTEM_PROMPT`. Tune it when:

- You see Claude consistently miscategorizing a kind of issue.
- A new category of out-of-scope report starts appearing (e.g., bot reports, spam).
- You want to adjust the bar between `qol-improvement` and `feature`.

Always test prompt changes locally with `--issue <num>` against a few representative real issues before merging.
