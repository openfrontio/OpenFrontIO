import type { Octokit } from "@octokit/rest";
import { COMMENTS, LABELS, STALE_CLOSE_DAYS, STALE_WARN_DAYS } from "../config";
import {
  type Action,
  type Issue,
  type IssueComment,
  isBotUser,
  listIssueComments,
} from "../github";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso).getTime();
  return (now.getTime() - from) / MS_PER_DAY;
}

export function latestNonBotActivityIso(
  issue: Issue,
  comments: IssueComment[],
): string {
  let latest = issue.created_at;
  for (const c of comments) {
    if (isBotUser(c.user)) continue;
    if (new Date(c.created_at).getTime() > new Date(latest).getTime()) {
      latest = c.created_at;
    }
  }
  return latest;
}

export async function checkStale(
  issue: Issue,
  octokit: Octokit,
  now: Date = new Date(),
): Promise<Action[]> {
  if (issue.milestone !== null) return [];
  if (issue.labels.includes(LABELS.KEEP_OPEN)) return [];

  const comments = await listIssueComments(octokit, issue.number);
  const lastActivityIso = latestNonBotActivityIso(issue, comments);
  const daysSinceActivity = daysBetween(lastActivityIso, now);
  const hasStaleLabel = issue.labels.includes(LABELS.STALE);
  const authorLogin = issue.user?.login ?? "there";

  if (hasStaleLabel && daysSinceActivity < STALE_WARN_DAYS) {
    return [{ type: "remove_label", label: LABELS.STALE }];
  }
  if (hasStaleLabel && daysSinceActivity >= STALE_CLOSE_DAYS) {
    return [
      { type: "add_label", label: LABELS.AUTO_CLOSED_STALE },
      { type: "comment", body: COMMENTS.AUTO_CLOSED_STALE(authorLogin) },
      { type: "close", reason: "not_planned" },
    ];
  }
  if (!hasStaleLabel && daysSinceActivity >= STALE_WARN_DAYS) {
    return [
      { type: "add_label", label: LABELS.STALE },
      { type: "comment", body: COMMENTS.STALE_WARNING(authorLogin) },
    ];
  }
  return [];
}
