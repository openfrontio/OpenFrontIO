import { Octokit } from "@octokit/rest";
import { LABEL_COLORS, LABEL_DESCRIPTIONS, LABELS, REPO } from "./config";

export type Issue = {
  number: number;
  state: "open" | "closed";
  milestone: { number: number; title: string } | null;
  labels: string[];
  assignees: { login: string }[];
  user: { login: string; type: string } | null;
  created_at: string;
  is_pull_request: boolean;
};

export type IssueComment = {
  created_at: string;
  user: { login: string; type: string } | null;
};

export type Action =
  | { type: "add_label"; label: string }
  | { type: "remove_label"; label: string }
  | { type: "comment"; body: string }
  | { type: "unassign"; users: string[] }
  | { type: "close"; reason: "not_planned" | "completed" };

export function makeOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export function isBotUser(
  user: { login: string; type: string } | null,
): boolean {
  if (!user) return false;
  if (user.type === "Bot") return true;
  if (user.login.endsWith("[bot]")) return true;
  return false;
}

function normalizeIssue(data: {
  number: number;
  state: string;
  milestone: { number: number; title: string } | null;
  labels: ({ name?: string } | string)[];
  assignees?: { login: string }[] | null;
  user: { login: string; type: string } | null;
  created_at: string;
  pull_request?: unknown;
}): Issue {
  return {
    number: data.number,
    state: data.state === "closed" ? "closed" : "open",
    milestone: data.milestone
      ? { number: data.milestone.number, title: data.milestone.title }
      : null,
    labels: (data.labels ?? [])
      .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
      .filter((name) => name.length > 0),
    assignees: (data.assignees ?? []).map((a) => ({ login: a.login })),
    user: data.user ? { login: data.user.login, type: data.user.type } : null,
    created_at: data.created_at,
    is_pull_request:
      data.pull_request !== undefined && data.pull_request !== null,
  };
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
    return normalizeIssue(data);
  } catch (err) {
    if (isStatus(err, 404)) {
      console.warn(`[issue-lifecycle] Issue #${issueNumber} not found`);
      return null;
    }
    throw err;
  }
}

export async function* iterateOpenIssues(
  octokit: Octokit,
): AsyncGenerator<Issue> {
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
    ...REPO,
    state: "open",
    per_page: 100,
  });
  for await (const { data } of iterator) {
    for (const raw of data) {
      const issue = normalizeIssue(raw);
      if (issue.is_pull_request) continue;
      yield issue;
    }
  }
}

export async function listIssueComments(
  octokit: Octokit,
  issueNumber: number,
): Promise<IssueComment[]> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...REPO,
    issue_number: issueNumber,
    per_page: 100,
  });
  return comments.map((c) => ({
    created_at: c.created_at,
    user: c.user ? { login: c.user.login, type: c.user.type } : null,
  }));
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
      // 422 = concurrent run created the label between our get and create.
      if (!isStatus(createErr, 422)) throw createErr;
    }
  }
}

export async function ensureAllLabels(octokit: Octokit): Promise<void> {
  for (const name of Object.values(LABELS)) {
    await ensureLabel(octokit, name);
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
    // 404 means label wasn't on the issue — treat as success.
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

export async function unassignUsers(
  octokit: Octokit,
  issueNumber: number,
  users: string[],
): Promise<void> {
  await octokit.rest.issues.removeAssignees({
    ...REPO,
    issue_number: issueNumber,
    assignees: users,
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
      case "unassign":
        if (action.users.length > 0) {
          await unassignUsers(octokit, issueNumber, action.users);
        }
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
    case "unassign":
      return `unassign(${action.users.join(",")})`;
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
