import { Octokit } from "@octokit/rest";
import {
  FORBIDDEN_LABELS,
  LABELS,
  LABEL_COLORS,
  LABEL_DESCRIPTIONS,
  REPO,
} from "./config";

export type Issue = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  user: { login: string } | null;
  author_association: string;
  created_at: string;
  updated_at: string;
  is_pull_request: boolean;
};

export type PullRequest = {
  number: number;
  title: string;
  body: string;
  user: { login: string } | null;
  author_association: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  head_sha: string;
};

export type PullRequestReview = {
  user_login: string | null;
  submitted_at: string | null;
  commit_id: string | null;
  state: string;
};

export type Action =
  | { type: "add_label"; label: string }
  | { type: "remove_label"; label: string }
  | { type: "comment"; body: string }
  | { type: "close"; reason: "not_planned" | "completed" };

export function makeOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

type RawIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: ({ name?: string } | string)[];
  user: { login: string } | null;
  author_association?: string | null;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
};

function normalizeIssue(data: RawIssue): Issue {
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    state: data.state === "closed" ? "closed" : "open",
    labels: (data.labels ?? [])
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter((name) => name.length > 0),
    user: data.user ? { login: data.user.login } : null,
    author_association: data.author_association ?? "NONE",
    created_at: data.created_at,
    updated_at: data.updated_at,
    is_pull_request:
      data.pull_request !== undefined && data.pull_request !== null,
  };
}

export function hasLabel(issue: Issue, label: string): boolean {
  return issue.labels.includes(label);
}

export async function getIssue(
  octokit: Octokit,
  issueNumber: number,
): Promise<Issue | null> {
  try {
    const { data } = await octokit.rest.issues.get({
      ...REPO,
      issue_number: issueNumber,
    });
    return normalizeIssue(data as RawIssue);
  } catch (err) {
    if (isStatus(err, 404)) {
      console.warn(`[claude-cron] issue #${issueNumber} not found`);
      return null;
    }
    throw err;
  }
}

export async function listOpenIssues(octokit: Octokit): Promise<Issue[]> {
  const out: Issue[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
    ...REPO,
    state: "open",
    per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const raw of data) {
      const issue = normalizeIssue(raw as RawIssue);
      if (issue.is_pull_request) continue;
      out.push(issue);
    }
  }
  return out;
}

export async function listIssuesLabeled(
  octokit: Octokit,
  label: string,
  opts: { state?: "open" | "closed" | "all" } = {},
): Promise<Issue[]> {
  const out: Issue[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
    ...REPO,
    state: opts.state ?? "open",
    labels: label,
    per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const raw of data) {
      const issue = normalizeIssue(raw as RawIssue);
      if (issue.is_pull_request) continue;
      out.push(issue);
    }
  }
  return out;
}

export async function listOpenPRs(octokit: Octokit): Promise<PullRequest[]> {
  const out: PullRequest[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.list, {
    ...REPO,
    state: "open",
    per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const pr of data) {
      out.push({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
        user: pr.user ? { login: pr.user.login } : null,
        author_association: pr.author_association ?? "NONE",
        draft: pr.draft ?? false,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        head_sha: pr.head.sha,
      });
    }
  }
  return out;
}

export async function listPullReviews(
  octokit: Octokit,
  prNumber: number,
): Promise<PullRequestReview[]> {
  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    ...REPO,
    pull_number: prNumber,
    per_page: 100,
  });
  return reviews.map((r) => ({
    user_login: r.user?.login ?? null,
    submitted_at: r.submitted_at ?? null,
    commit_id: r.commit_id ?? null,
    state: r.state,
  }));
}

export async function fetchPRDiff(
  octokit: Octokit,
  prNumber: number,
): Promise<string> {
  const response = await octokit.rest.pulls.get({
    ...REPO,
    pull_number: prNumber,
    mediaType: { format: "diff" },
  });
  // When mediaType.format is "diff", Octokit returns the raw diff string as data.
  return response.data as unknown as string;
}

export async function ensureLabel(
  octokit: Octokit,
  name: string,
): Promise<void> {
  try {
    await octokit.rest.issues.getLabel({ ...REPO, name });
  } catch (err) {
    if (!isStatus(err, 404)) throw err;
    try {
      await octokit.rest.issues.createLabel({
        ...REPO,
        name,
        color: LABEL_COLORS[name] ?? "CCCCCC",
        description: LABEL_DESCRIPTIONS[name] ?? "",
      });
    } catch (createErr) {
      if (!isStatus(createErr, 422)) throw createErr;
    }
  }
}

export async function ensureAllLabels(octokit: Octokit): Promise<void> {
  for (const name of Object.values(LABELS)) {
    await ensureLabel(octokit, name);
  }
}

function assertNotForbidden(action: Action): void {
  if (action.type === "add_label" || action.type === "remove_label") {
    if (FORBIDDEN_LABELS.has(action.label)) {
      throw new Error(
        `[claude-cron] refusing to ${action.type} forbidden label "${action.label}" — managed by Layer A`,
      );
    }
  }
}

export async function addLabel(
  octokit: Octokit,
  issueNumber: number,
  label: string,
): Promise<void> {
  await octokit.rest.issues.addLabels({
    ...REPO,
    issue_number: issueNumber,
    labels: [label],
  });
}

export async function removeLabel(
  octokit: Octokit,
  issueNumber: number,
  label: string,
): Promise<void> {
  try {
    await octokit.rest.issues.removeLabel({
      ...REPO,
      issue_number: issueNumber,
      name: label,
    });
  } catch (err) {
    if (!isStatus(err, 404)) throw err;
  }
}

export async function postComment(
  octokit: Octokit,
  issueNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    ...REPO,
    issue_number: issueNumber,
    body,
  });
}

export async function closeIssue(
  octokit: Octokit,
  issueNumber: number,
  reason: "not_planned" | "completed",
): Promise<void> {
  await octokit.rest.issues.update({
    ...REPO,
    issue_number: issueNumber,
    state: "closed",
    state_reason: reason,
  });
}

export async function applyActions(
  octokit: Octokit,
  issueNumber: number,
  actions: Action[],
): Promise<void> {
  for (const action of actions) {
    assertNotForbidden(action);
  }
  for (const action of actions) {
    switch (action.type) {
      case "add_label":
        await ensureLabel(octokit, action.label);
        await addLabel(octokit, issueNumber, action.label);
        break;
      case "remove_label":
        await removeLabel(octokit, issueNumber, action.label);
        break;
      case "comment":
        await postComment(octokit, issueNumber, action.body);
        break;
      case "close":
        await closeIssue(octokit, issueNumber, action.reason);
        break;
    }
  }
}

export function describeAction(action: Action): string {
  switch (action.type) {
    case "add_label":
      return `add_label(${action.label})`;
    case "remove_label":
      return `remove_label(${action.label})`;
    case "comment":
      return `comment`;
    case "close":
      return `close(${action.reason})`;
  }
}

function isStatus(err: unknown, status: number): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === status
  );
}

export { assertNotForbidden };
