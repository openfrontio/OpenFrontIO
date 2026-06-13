import {
  APPROVED_ISSUE_LABEL,
  LABELS,
  SMALL_FIX_LINE_THRESHOLD,
  TRUSTED_REPO_PERMISSIONS,
} from "./config";

export type PRMetadata = {
  number: number;
  body: string | null;
  user: { login: string };
  labels: string[];
};

export type GetRepoPermission = (username: string) => Promise<string>;

export type PRFile = {
  additions: number;
  deletions: number;
};

export type IssueMetadata = {
  number: number;
  labels: string[];
  assignees: { login: string }[];
};

export type GetIssue = (issueNumber: number) => Promise<IssueMetadata | null>;

export type RuleResult =
  | { action: "pass"; reason: string; labelToAdd?: string }
  | { action: "close"; reason: string }
  | { action: "next" };

const LINKED_ISSUE_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

export function parseLinkedIssues(body: string | null): number[] {
  if (!body) return [];
  const stripped = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const result = new Set<number>();
  for (const m of stripped.matchAll(LINKED_ISSUE_RE)) {
    result.add(parseInt(m[1], 10));
  }
  return [...result];
}

export function checkBypass(pr: PRMetadata): RuleResult {
  if (pr.labels.includes(LABELS.BYPASS)) {
    return { action: "pass", reason: `PR has "${LABELS.BYPASS}" label` };
  }
  return { action: "next" };
}

export async function checkRepoAccess(
  pr: PRMetadata,
  getRepoPermission: GetRepoPermission,
): Promise<RuleResult> {
  const permission = await getRepoPermission(pr.user.login);
  if ((TRUSTED_REPO_PERMISSIONS as readonly string[]).includes(permission)) {
    return {
      action: "pass",
      reason: `Author has "${permission}" permission on the repo`,
    };
  }
  return { action: "next" };
}

export async function checkApprovedWork(
  pr: PRMetadata,
  getIssue: GetIssue,
): Promise<RuleResult> {
  const issueNumbers = parseLinkedIssues(pr.body);
  if (issueNumbers.length === 0) return { action: "next" };

  for (const issueNumber of issueNumbers) {
    const issue = await getIssue(issueNumber);
    if (!issue) continue;
    if (!issue.labels.includes(APPROVED_ISSUE_LABEL)) continue;
    const assigneeLogins = issue.assignees.map((a) => a.login);
    if (!assigneeLogins.includes(pr.user.login)) continue;
    return {
      action: "pass",
      reason: `Linked to #${issueNumber} (labelled "${APPROVED_ISSUE_LABEL}"), author is assigned`,
    };
  }
  return { action: "next" };
}

export function checkSmallFix(files: PRFile[]): RuleResult {
  const totalLines = files.reduce(
    (sum, f) => sum + f.additions + f.deletions,
    0,
  );
  if (totalLines <= SMALL_FIX_LINE_THRESHOLD) {
    return {
      action: "pass",
      reason: `Diff is ${totalLines} lines (≤ ${SMALL_FIX_LINE_THRESHOLD})`,
      labelToAdd: LABELS.SMALL_FIX,
    };
  }
  return { action: "next" };
}

export async function evaluate(
  pr: PRMetadata,
  files: PRFile[],
  getIssue: GetIssue,
  getRepoPermission: GetRepoPermission,
): Promise<RuleResult> {
  const r0 = checkBypass(pr);
  if (r0.action !== "next") return r0;

  const r1 = await checkRepoAccess(pr, getRepoPermission);
  if (r1.action !== "next") return r1;

  const r2 = await checkApprovedWork(pr, getIssue);
  if (r2.action !== "next") return r2;

  const r3 = checkSmallFix(files);
  if (r3.action !== "next") return r3;

  const totalLines = files.reduce(
    (sum, f) => sum + f.additions + f.deletions,
    0,
  );
  return {
    action: "close",
    reason: `No linked "${APPROVED_ISSUE_LABEL}" issue with author assigned, diff is ${totalLines} lines`,
  };
}
