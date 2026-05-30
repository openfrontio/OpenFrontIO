import Anthropic from "@anthropic-ai/sdk";
import type { AreaLabel, Classification } from "./config";
import {
  CLAUDE_MODEL,
  DIGEST_LOOKBACK_HOURS,
  MAINTAINER_LOGIN,
} from "./config";
import type { Issue, PullRequest } from "./github";

export type Confidence = "low" | "medium" | "high";

export type TriageDecision = {
  classification: Classification;
  confidence: Confidence;
  reasoning: string;
  suggested_area?: AreaLabel;
  duplicate_of?: number;
  clarifying_questions?: string[];
};

export type PRReview = {
  summary: string;
  risk: "low" | "medium" | "high";
  tests_present: "yes" | "no" | "n/a";
  scope_match: "matches" | "expanded" | "no_linked_issue";
  ai_smell?: "low" | "medium" | "high";
  concerns?: string[];
};

export type DigestResult = {
  markdown: string;
  maintainer_actions?: string[];
};

export type UsageStats = {
  input_tokens: number;
  output_tokens: number;
};

export function makeAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

// ---------------------------------------------------------------------------
// Tool schemas — force structured output via tool_choice
// ---------------------------------------------------------------------------

export const TRIAGE_TOOL = {
  name: "submit_triage_decision",
  description: "Submit your triage decision for this GitHub issue.",
  input_schema: {
    type: "object" as const,
    required: ["classification", "confidence", "reasoning"],
    properties: {
      classification: {
        type: "string",
        enum: [
          "bug",
          "qol-improvement",
          "duplicate",
          "needs-info",
          "feature",
          "question",
          "support",
          "billing",
          "security",
          "translation",
          "uncertain",
        ],
        description: "The category this issue falls into.",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "How confident you are. Auto-close categories require 'high' confidence to take action; below that, the system downgrades to 'uncertain'.",
      },
      reasoning: {
        type: "string",
        description:
          "One or two sentences explaining the classification. Will be logged for audit.",
      },
      suggested_area: {
        type: "string",
        enum: [
          "area:client",
          "area:core",
          "area:server",
          "area:map-generator",
          "area:other",
        ],
        description:
          "For 'bug' or 'qol-improvement' only. Best-guess area of the codebase.",
      },
      duplicate_of: {
        type: "integer",
        description:
          "For 'duplicate' classification only. The issue number this duplicates. Must be drawn from the provided recent-issues list and must be currently open.",
      },
      clarifying_questions: {
        type: "array",
        items: { type: "string" },
        description:
          "For 'needs-info' classification only. Specific questions to ask the reporter — not generic 'please provide more info'. Each item is one question.",
      },
    },
  },
} as const;

export const PR_REVIEW_TOOL = {
  name: "submit_pr_review",
  description: "Submit a quick-review summary of a GitHub pull request.",
  input_schema: {
    type: "object" as const,
    required: ["summary", "risk", "tests_present", "scope_match"],
    properties: {
      summary: {
        type: "string",
        description:
          "One sentence (max ~80 chars) describing what this PR does.",
      },
      risk: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "Risk assessment based on what code is touched and how. src/core changes are higher risk; UI-only changes are lower.",
      },
      tests_present: {
        type: "string",
        enum: ["yes", "no", "n/a"],
        description:
          "For PRs touching src/core, tests are required. 'n/a' if no src/core changes.",
      },
      scope_match: {
        type: "string",
        enum: ["matches", "expanded", "no_linked_issue"],
        description:
          "Does the PR match the scope of its linked issue? 'expanded' if it does extra things beyond what the issue asked for.",
      },
      ai_smell: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "Likelihood this is unsupervised LLM output. Look for: invented APIs, inconsistent style, over-commented obvious lines, defensive code around impossible cases.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description:
          "Specific things the maintainer should look at first. Empty if none.",
      },
    },
  },
} as const;

export const DIGEST_TOOL = {
  name: "submit_digest",
  description: "Submit the daily triage digest for the maintainer.",
  input_schema: {
    type: "object" as const,
    required: ["markdown"],
    properties: {
      markdown: {
        type: "string",
        description:
          "The full digest as GitHub-flavored markdown. Follow the format specified in the system prompt. Omit empty sections.",
      },
      maintainer_actions: {
        type: "array",
        items: { type: "string" },
        description:
          "Concrete suggested actions for the maintainer this morning (e.g., 'Milestone #123 to backlog').",
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

export const TRIAGE_SYSTEM_PROMPT = `You are the triage assistant for OpenFront.io, a browser-based real-time strategy game written in TypeScript. The codebase has four main components:

- \`src/client/\` — rendering (WebGL), UI (Lit web components + Tailwind), WebSocket comms.
- \`src/core/\` — deterministic game simulation (no external deps, runs in a Web Worker).
- \`src/server/\` — Node.js/Express/ws coordinator.
- \`map-generator/\` — Go program that generates map binaries.

Your job is to classify an incoming issue into exactly one category and report your confidence. The system applies actions automatically based on your decision. Be conservative — when uncertain, return \`uncertain\`. False-closing a real bug is worse than leaving an uncertain issue open for the maintainer to look at.

## Classification taxonomy

**bug** — Reproducible defect in existing functionality. Crashes, wrong rendering, server errors, broken game logic. The game does X but should do Y.

**qol-improvement** — Small-scope work reasonably completable by one contributor in under a week. Includes hotkey additions, confirmation dialogs, UI tweaks, minor behavior changes, **small new features that don't require new game systems**, sound/visual polish, and performance improvements to existing code paths. The line is *scope/effort*, not "is it new functionality."

**duplicate** — Same issue (semantically, not lexically) exists in the recent open-issues context. You MUST cite the duplicate issue number. Do not suggest duplicates of closed issues — they're parked or rejected.

**needs-info** — Plausibly a bug or QoL, but lacks specifics needed to act: no repro steps, no version (\`gitCommit\`), no expected-vs-actual. Provide *specific* clarifying questions, not generic "please provide more info."

**feature** — Substantial new system. Multi-week scope. Touches multiple subsystems. Examples: new unit types, new game modes, achievement systems, alternate currencies, cosmetic systems, new map *types* (not "add one more map"), new alliance mechanics, anything needing new art assets or new networked state.

**question** — Asking about the codebase, contributing, building from source, architecture.

**support** — Player asking for help playing: can't connect, account issues, reporting players, troubleshooting their local environment.

**billing** — Any mention of money: purchases, subscriptions, refunds, premium, payment failures. Even if there's also a technical defect, classify as billing — support has billing access.

**security** — Vulnerability reports, exploit disclosures, anything that shouldn't be public. The system will NOT auto-close these or post a comment — it just routes to \`claude-uncertain\` so the maintainer can handle them discreetly (closing wouldn't make the issue private anyway).

**translation** — Localization issues, language errors, new-language requests.

**uncertain** — You can't confidently place this in any other category. Default to this.

## Tie-breaking

- Bug + billing → **billing.**
- Bug + support: specific reproducible defect → **bug**, vague "doesn't work for me" → **support**, doubt → **bug**.
- Feature vs. QoL: new assets/systems → **feature**, tweak to existing flow → **qol-improvement**, doubt → **uncertain** (do NOT default to feature; that auto-closes).

## Examples

- "Game crashes when I right-click in spectator mode after 5 minutes" → **bug** (reproducible defect, specific trigger), area:client, confidence: high.
- "Could you add a hotkey to toggle the chat?" → **qol-improvement** (small UI tweak), area:client, confidence: high.
- "Game is buggy" with no body → **needs-info**, clarifying_questions: ["Which specific bug?", "Steps to reproduce?", "Which browser and OS?"], confidence: high.
- "Add an espionage mechanic with hidden units" → **feature** (new game system), confidence: high.
- "Refund my purchase, it doesn't work" → **billing**, confidence: high.
- "How do I run the dev server?" → **question**, confidence: high.
- "Can't connect to any game" → **support** unless concrete repro steps are given.
- "I think there's an XSS in the chat" → **security**, confidence: high.
- Issue text identical in shape to recent open #1234 → **duplicate**, duplicate_of: 1234.
- Something ambiguous, e.g. an issue with rich but unclear repro that could be a bug or could be PEBKAC → **uncertain** (keep it open for the maintainer).

## Confidence

Auto-close categories (feature, question, support, billing, translation) require \`confidence: high\` for the system to act on them. Anything lower will be downgraded to \`uncertain\` and stay open. So:

- For an auto-close category, use \`high\` only if you'd defend the decision to the maintainer.
- For label-only categories (bug, qol-improvement, duplicate, needs-info, security), any confidence is fine; the consequences are small and reversible.

## Hard rules

- NEVER suggest setting a milestone. Milestones are maintainer-only.
- NEVER suggest \`approved\` or \`not-approved\` labels. Layer A manages those automatically based on milestone state.
- NEVER suggest assigning anyone.
- NEVER reopen closed issues; never reference them as duplicates.
- Being skeptical and returning \`uncertain\` is better than miscategorizing.

Call the \`submit_triage_decision\` tool exactly once.`;

export const PR_REVIEW_SYSTEM_PROMPT = `You are a code-review assistant doing a *fast triage pass* on a pull request for OpenFront.io, a browser-based RTS written in TypeScript.

Your output is one row in the maintainer's daily digest. It should:

- Summarize the PR in one sentence (max ~80 chars).
- Assess risk based on what code is touched: \`src/core\` (deterministic simulation) is highest risk, \`src/server\` medium, \`src/client\` lower, docs/tests/config typically low.
- Report whether tests are present. **Tests are required for any change in \`src/core\`.** Use 'n/a' only when no \`src/core\` files are touched.
- Compare against the linked issue's scope. 'expanded' means the PR does noticeably more than the issue asked for (often a red flag). 'no_linked_issue' if the PR doesn't reference an issue.
- Optionally flag AI smells: invented APIs, inconsistent style, overly defensive code for impossible cases, dense comments on obvious lines.
- Note specific concerns the maintainer should look at first, if any.

Be terse. The output goes into a maintainer digest scanned at a glance. Call the \`submit_pr_review\` tool exactly once.`;

export const DIGEST_SYSTEM_PROMPT = `You are writing a daily triage digest for ${MAINTAINER_LOGIN} (Evan), the maintainer of OpenFront.io.

The digest is a brief morning briefing. It tells Evan what needs his attention today.

## Required structure (markdown)

\`\`\`markdown
# Daily Triage — YYYY-MM-DD

## 🟢 Newly classified by Claude (N)
- #123 — short summary · suggested action
- ...

## 🟡 Needs your judgment (M)
- #125 — Claude flagged 'claude-uncertain' because [reason]

## 🔴 Auto-closing in <24h (K)
- #126 — \`stale\`, milestone or let close

## 🟠 Awaiting your milestone (Q)
- #45 [bug, area:client] — 21d — Crash on right-click
- #76 [qol-improvement] — 12d — Add chat hotkey
- ...

## 🔵 PRs needing review (P)
- #220 by @alice — fixes alliance UI bug · src/client only · tests ✓
- ...

## Patterns
[Only if you noticed something specific. Otherwise omit this section entirely.]

## Recommended actions
- Milestone #123 as backlog
- ...
\`\`\`

## Rules

- Target length: 200–600 words. Should fit in one or two screenfuls.
- Omit any section that has no entries. Do not write "No items" rows.
- Direct address: "Evan, today you have..." is fine if it's natural; don't force it.
- For each PR, surface the pre-computed quick review: risk, tests, scope match. Don't speculate beyond what's given.
- **Awaiting your milestone**: list ALL items from the input verbatim. This is the full backlog of un-milestoned issues. Don't truncate or sample — Evan wants to see every one. The bracketed tags (e.g. \`[bug, area:client]\`) and age (e.g. \`21d\`) come straight from the input; pass them through unchanged.
- **Patterns**: only mention if the input genuinely shows a cluster (e.g., 4+ new issues mentioning the same map or feature). Do NOT invent patterns. Omit the section if nothing notable.
- **Recommended actions**: 2–5 concrete items maximum. Each is something Evan can do today in <5 minutes.
- Use the issue/PR data exactly as provided. Don't hallucinate numbers, authors, or labels.

Call the \`submit_digest\` tool exactly once with the full markdown.`;

// ---------------------------------------------------------------------------
// Input formatters
// ---------------------------------------------------------------------------

const MAX_BODY_CHARS = 4000;
const MAX_DIFF_CHARS = 20000;
const RECENT_ISSUE_SUMMARY_CHARS = 100;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n…[truncated; ${s.length - max} chars omitted]`;
}

export function formatIssueForTriage(
  issue: Issue,
  recentOpenIssues: Issue[],
): string {
  const body =
    issue.body.trim() === ""
      ? "_(empty body)_"
      : truncate(issue.body, MAX_BODY_CHARS);
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "(none)";
  const recent = recentOpenIssues
    .filter((r) => r.number !== issue.number)
    .map((r) => {
      const snippet = r.body
        .replace(/\s+/g, " ")
        .slice(0, RECENT_ISSUE_SUMMARY_CHARS)
        .trim();
      return `- #${r.number}: ${r.title} — ${snippet}`;
    })
    .join("\n");

  return `## Issue to classify

- Number: #${issue.number}
- Author: @${issue.user?.login ?? "unknown"}
- Author association: ${issue.author_association}
- Created: ${issue.created_at}
- Existing labels: ${labels}

### Title
${issue.title}

### Body
${body}

---

## Recent open issues (for duplicate detection only, NOT for classifying this issue)

${recent || "_(no other open issues)_"}

---

Classify the issue above. Call \`submit_triage_decision\` exactly once.`;
}

export function formatPRForReview(
  pr: PullRequest,
  diff: string,
  linkedIssue: Issue | null,
): string {
  const description =
    pr.body.trim() === ""
      ? "_(empty description)_"
      : truncate(pr.body, MAX_BODY_CHARS);
  const linkedIssueBlock = linkedIssue
    ? `## Linked issue #${linkedIssue.number}: ${linkedIssue.title}

${truncate(linkedIssue.body || "_(empty body)_", 1500)}`
    : "_(no linked issue detected)_";

  return `## Pull request to review

- Number: #${pr.number}
- Author: @${pr.user?.login ?? "unknown"} (association: ${pr.author_association})
- Title: ${pr.title}
- Created: ${pr.created_at}

### Description
${description}

${linkedIssueBlock}

## Diff

\`\`\`diff
${truncate(diff, MAX_DIFF_CHARS)}
\`\`\`

Review the PR above. Call \`submit_pr_review\` exactly once.`;
}

export type DigestInputs = {
  today: string;
  triageReadyInWindow: {
    number: number;
    title: string;
    author: string;
    area: string | null;
  }[];
  needsMaintainerTriage: {
    number: number;
    title: string;
    reasoning?: string;
  }[];
  needsInfoCount: number;
  staleClosingSoon: { number: number; title: string }[];
  awaitingMilestone: {
    number: number;
    title: string;
    ageDays: number;
    primaryLabel: string | null;
    area: string | null;
  }[];
  prReviews: {
    pr: { number: number; title: string; author: string };
    review: PRReview;
  }[];
  triageSummary: { processed: number; closed: number; kept: number };
};

export function formatDigestInputs(inputs: DigestInputs): string {
  const triageReady =
    inputs.triageReadyInWindow.length === 0
      ? "_(none)_"
      : inputs.triageReadyInWindow
          .map(
            (i) =>
              `- #${i.number} by @${i.author}${i.area ? ` [${i.area}]` : ""}: ${i.title}`,
          )
          .join("\n");

  const needsTriage =
    inputs.needsMaintainerTriage.length === 0
      ? "_(none)_"
      : inputs.needsMaintainerTriage
          .map(
            (i) =>
              `- #${i.number}: ${i.title}${i.reasoning ? ` — Claude's reasoning: ${i.reasoning}` : ""}`,
          )
          .join("\n");

  const stale =
    inputs.staleClosingSoon.length === 0
      ? "_(none)_"
      : inputs.staleClosingSoon
          .map((i) => `- #${i.number}: ${i.title}`)
          .join("\n");

  const awaitingMilestone =
    inputs.awaitingMilestone.length === 0
      ? "_(none)_"
      : inputs.awaitingMilestone
          .map((i) => {
            const tags = [i.primaryLabel, i.area].filter(Boolean).join(", ");
            const tagStr = tags ? ` [${tags}]` : "";
            return `- #${i.number}${tagStr} — ${i.ageDays}d — ${i.title}`;
          })
          .join("\n");

  const prs =
    inputs.prReviews.length === 0
      ? "_(none)_"
      : inputs.prReviews
          .map(({ pr, review }) => {
            const concerns =
              review.concerns && review.concerns.length > 0
                ? ` · concerns: ${review.concerns.join("; ")}`
                : "";
            const ai =
              review.ai_smell && review.ai_smell !== "low"
                ? ` · ai-smell: ${review.ai_smell}`
                : "";
            return `- #${pr.number} by @${pr.author}: ${pr.title}
  summary: ${review.summary}
  risk: ${review.risk} · tests: ${review.tests_present} · scope: ${review.scope_match}${ai}${concerns}`;
          })
          .join("\n");

  return `Today: ${inputs.today}

## Triage pass summary (last 24h)
- Processed: ${inputs.triageSummary.processed}
- Auto-closed: ${inputs.triageSummary.closed}
- Kept open: ${inputs.triageSummary.kept}

## Newly classified by Claude (last ${DIGEST_LOOKBACK_HOURS}h, label: claude-approved)
${triageReady}

## Needs maintainer triage (label: claude-uncertain)
${needsTriage}

## Needs info (label: needs-info)
Count: ${inputs.needsInfoCount}

## Stale, closing soon (label: stale; Layer A will close in <24h unless milestoned)
${stale}

## Awaiting your milestone (label: not-approved; full open backlog, sorted oldest first)
${awaitingMilestone}

## Open PRs awaiting maintainer review (any author)
${prs}

Compose the digest now. Follow the format in the system prompt. Omit empty sections.`;
}

// ---------------------------------------------------------------------------
// API call helpers
// ---------------------------------------------------------------------------

type ToolUseBlock = {
  type: "tool_use";
  name: string;
  input: unknown;
};

function findToolUse(
  content: Anthropic.Messages.ContentBlock[],
  expectedName: string,
): ToolUseBlock {
  for (const block of content) {
    if (block.type === "tool_use") {
      const tu = block as unknown as ToolUseBlock;
      if (tu.name !== expectedName) {
        throw new Error(
          `Claude returned tool_use for unexpected tool "${tu.name}" (expected "${expectedName}")`,
        );
      }
      return tu;
    }
  }
  throw new Error(
    `Claude response had no tool_use block (expected "${expectedName}")`,
  );
}

export type CallResult<T> = { value: T; usage: UsageStats };

async function callClaudeWithTool<T>(
  anthropic: Anthropic,
  args: {
    system: string;
    userContent: string;
    tool: {
      name: string;
      description: string;
      input_schema: { type: "object" } & Record<string, unknown>;
    };
    maxTokens: number;
  },
): Promise<CallResult<T>> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: [{ role: "user", content: args.userContent }],
    tools: [args.tool],
    tool_choice: { type: "tool", name: args.tool.name },
  });
  const tu = findToolUse(response.content, args.tool.name);
  return {
    value: tu.input as T,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

export async function classifyIssue(
  anthropic: Anthropic,
  issue: Issue,
  recentOpenIssues: Issue[],
): Promise<CallResult<TriageDecision>> {
  return callClaudeWithTool<TriageDecision>(anthropic, {
    system: TRIAGE_SYSTEM_PROMPT,
    userContent: formatIssueForTriage(issue, recentOpenIssues),
    tool: TRIAGE_TOOL,
    maxTokens: 1024,
  });
}

export async function reviewPR(
  anthropic: Anthropic,
  pr: PullRequest,
  diff: string,
  linkedIssue: Issue | null,
): Promise<CallResult<PRReview>> {
  return callClaudeWithTool<PRReview>(anthropic, {
    system: PR_REVIEW_SYSTEM_PROMPT,
    userContent: formatPRForReview(pr, diff, linkedIssue),
    tool: PR_REVIEW_TOOL,
    maxTokens: 800,
  });
}

export async function composeDigest(
  anthropic: Anthropic,
  inputs: DigestInputs,
): Promise<CallResult<DigestResult>> {
  return callClaudeWithTool<DigestResult>(anthropic, {
    system: DIGEST_SYSTEM_PROMPT,
    userContent: formatDigestInputs(inputs),
    tool: DIGEST_TOOL,
    maxTokens: 2000,
  });
}
