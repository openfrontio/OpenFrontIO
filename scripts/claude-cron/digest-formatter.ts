import type { Octokit } from "@octokit/rest";
import type { DigestInputs } from "./claude";
import { DIGEST_LOOKBACK_HOURS, LABELS, LAYER_A_LABELS } from "./config";
import { type Issue, listIssuesLabeled } from "./github";
import type { TriagePassResult } from "./pass1-triage";
import type { PRReviewRecord } from "./pr-reviewer";

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

const AREA_LABEL_PREFIX = "area:";

// Order matters: the first match in this list is reported as the issue's
// primary Claude label in the digest.
const PRIMARY_CLAUDE_LABELS = [
  LABELS.BUG,
  LABELS.QOL_IMPROVEMENT,
  LABELS.CLAUDE_UNCERTAIN,
  LABELS.NEEDS_INFO,
  LABELS.POSSIBLE_DUPLICATE,
] as const;

function findAreaLabel(issue: Issue): string | null {
  const area = issue.labels.find((l) => l.startsWith(AREA_LABEL_PREFIX));
  return area ?? null;
}

function findPrimaryClaudeLabel(issue: Issue): string | null {
  for (const candidate of PRIMARY_CLAUDE_LABELS) {
    if (issue.labels.includes(candidate)) return candidate;
  }
  return null;
}

export function ageDays(createdAt: string, now: Date): number {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return 0;
  return Math.max(0, Math.floor((now.getTime() - createdMs) / MS_PER_DAY));
}

function isWithinLookback(
  updatedAt: string,
  now: Date,
  hours: number,
): boolean {
  const updatedMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedMs)) return false;
  return now.getTime() - updatedMs <= hours * MS_PER_HOUR;
}

export type GatherDigestInputsArgs = {
  octokit: Octokit;
  now: Date;
  triagePass: TriagePassResult;
  prReviews: PRReviewRecord[];
};

export async function gatherDigestInputs(
  args: GatherDigestInputsArgs,
): Promise<DigestInputs> {
  const { octokit, now, triagePass, prReviews } = args;

  const [
    triageReadyAll,
    needsTriageAll,
    needsInfoAll,
    staleAll,
    notApprovedAll,
  ] = await Promise.all([
    listIssuesLabeled(octokit, LABELS.CLAUDE_APPROVED),
    listIssuesLabeled(octokit, LABELS.CLAUDE_UNCERTAIN),
    listIssuesLabeled(octokit, LABELS.NEEDS_INFO),
    listIssuesLabeled(octokit, LAYER_A_LABELS.STALE),
    listIssuesLabeled(octokit, LAYER_A_LABELS.NOT_APPROVED),
  ]);

  const triageReadyInWindow = triageReadyAll
    .filter((i) => isWithinLookback(i.updated_at, now, DIGEST_LOOKBACK_HOURS))
    .map((i) => ({
      number: i.number,
      title: i.title,
      author: i.user?.login ?? "unknown",
      area: findAreaLabel(i),
    }));

  const needsMaintainerTriage = needsTriageAll.map((i) => {
    const record = triagePass.recordsByNumber.get(i.number);
    return {
      number: i.number,
      title: i.title,
      reasoning: record?.decision.reasoning,
    };
  });

  const staleClosingSoon = staleAll.map((i) => ({
    number: i.number,
    title: i.title,
  }));

  const awaitingMilestone = notApprovedAll
    .map((i) => ({
      number: i.number,
      title: i.title,
      ageDays: ageDays(i.created_at, now),
      primaryLabel: findPrimaryClaudeLabel(i),
      area: findAreaLabel(i),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);

  return {
    today: formatIsoDate(now),
    triageReadyInWindow,
    needsMaintainerTriage,
    needsInfoCount: needsInfoAll.length,
    staleClosingSoon,
    awaitingMilestone,
    prReviews: prReviews.map(({ pr, review }) => ({
      pr: {
        number: pr.number,
        title: pr.title,
        author: pr.user?.login ?? "unknown",
      },
      review,
    })),
    triageSummary: {
      processed: triagePass.processed,
      closed: triagePass.closed,
      kept: triagePass.kept,
    },
  };
}

export function formatIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Fallback digest used when Claude composition fails. Deterministic markdown
 * rendered directly from the inputs. Never the preferred path — Claude's
 * version is more readable — but useful as a safety net.
 */
export function renderFallbackDigest(inputs: DigestInputs): string {
  const sections: string[] = [`# Daily Triage — ${inputs.today}`];

  if (inputs.triageReadyInWindow.length > 0) {
    sections.push(
      `## 🟢 Newly classified by Claude (${inputs.triageReadyInWindow.length})`,
      ...inputs.triageReadyInWindow.map(
        (i) =>
          `- #${i.number}${i.area ? ` [${i.area}]` : ""} — ${i.title} (by @${i.author})`,
      ),
    );
  }

  if (inputs.needsMaintainerTriage.length > 0) {
    sections.push(
      `## 🟡 Needs your judgment (${inputs.needsMaintainerTriage.length})`,
      ...inputs.needsMaintainerTriage.map(
        (i) =>
          `- #${i.number} — ${i.title}${i.reasoning ? ` _(${i.reasoning})_` : ""}`,
      ),
    );
  }

  if (inputs.staleClosingSoon.length > 0) {
    sections.push(
      `## 🔴 Auto-closing in <24h (${inputs.staleClosingSoon.length})`,
      ...inputs.staleClosingSoon.map((i) => `- #${i.number} — ${i.title}`),
    );
  }

  if (inputs.awaitingMilestone.length > 0) {
    sections.push(
      `## 🟠 Awaiting your milestone (${inputs.awaitingMilestone.length})`,
      ...inputs.awaitingMilestone.map((i) => {
        const tags = [i.primaryLabel, i.area].filter(Boolean).join(", ");
        const tagStr = tags ? ` [${tags}]` : "";
        return `- #${i.number}${tagStr} — ${i.ageDays}d — ${i.title}`;
      }),
    );
  }

  if (inputs.prReviews.length > 0) {
    sections.push(
      `## 🔵 PRs needing review (${inputs.prReviews.length})`,
      ...inputs.prReviews.map(({ pr, review }) => {
        const flags = [
          `risk: ${review.risk}`,
          `tests: ${review.tests_present}`,
          `scope: ${review.scope_match}`,
        ].join(" · ");
        return `- #${pr.number} by @${pr.author} — ${review.summary} · ${flags}`;
      }),
    );
  }

  if (inputs.needsInfoCount > 0) {
    sections.push(
      `_${inputs.needsInfoCount} issues waiting on reporter (\`needs-info\`)._`,
    );
  }

  sections.push(
    `— *Fallback digest (Claude composition failed). Generated deterministically.*`,
  );
  return sections.join("\n\n");
}

/**
 * Strip a digest down to the Discord 2000-char limit. Adds a truncation
 * marker if anything had to be dropped.
 */
export function truncateForDiscord(markdown: string, limit = 1900): string {
  if (markdown.length <= limit) return markdown;
  return markdown.slice(0, limit) + "\n…(truncated)";
}
