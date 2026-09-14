import { Octokit } from "@octokit/rest";
import { LABEL_COLORS, LABEL_DESCRIPTIONS, REPO } from "./config";
import type { IssueMetadata, PRFile, PRMetadata } from "./rules";

export function makeOctokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export async function getPR(
  octokit: Octokit,
  prNumber: number,
): Promise<PRMetadata> {
  const { data } = await octokit.rest.pulls.get({
    ...REPO,
    pull_number: prNumber,
  });
  return {
    number: data.number,
    body: data.body ?? null,
    user: { login: data.user?.login ?? "" },
    labels: (data.labels ?? [])
      .map((l) => l.name ?? "")
      .filter((name) => name.length > 0),
  };
}

export async function getPRFiles(
  octokit: Octokit,
  prNumber: number,
): Promise<PRFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    ...REPO,
    pull_number: prNumber,
    per_page: 100,
  });
  return files.map((f) => ({ additions: f.additions, deletions: f.deletions }));
}

export async function getRepoPermission(
  octokit: Octokit,
  username: string,
): Promise<string> {
  try {
    const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
      ...REPO,
      username,
    });
    return data.permission;
  } catch (err) {
    if (isStatus(err, 404)) return "none";
    throw err;
  }
}

export async function getIssue(
  octokit: Octokit,
  issueNumber: number,
): Promise<IssueMetadata | null> {
  try {
    const { data } = await octokit.rest.issues.get({
      ...REPO,
      issue_number: issueNumber,
    });
    return {
      number: data.number,
      labels: (data.labels ?? [])
        .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
        .filter((name) => name.length > 0),
      assignees: (data.assignees ?? []).map((a) => ({ login: a.login })),
    };
  } catch (err) {
    if (isStatus(err, 404)) {
      console.warn(`[pr-gate] Issue #${issueNumber} not found, skipping`);
      return null;
    }
    throw err;
  }
}

export async function ensureLabel(
  octokit: Octokit,
  name: string,
): Promise<void> {
  try {
    await octokit.rest.issues.getLabel({ ...REPO, name });
  } catch (err) {
    if (!isStatus(err, 404)) throw err;
    await octokit.rest.issues.createLabel({
      ...REPO,
      name,
      color: LABEL_COLORS[name],
      description: LABEL_DESCRIPTIONS[name],
    });
  }
}

export async function addLabel(
  octokit: Octokit,
  prNumber: number,
  label: string,
): Promise<void> {
  await octokit.rest.issues.addLabels({
    ...REPO,
    issue_number: prNumber,
    labels: [label],
  });
}

export async function postComment(
  octokit: Octokit,
  prNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({
    ...REPO,
    issue_number: prNumber,
    body,
  });
}

export async function closePR(
  octokit: Octokit,
  prNumber: number,
): Promise<void> {
  await octokit.rest.pulls.update({
    ...REPO,
    pull_number: prNumber,
    state: "closed",
  });
}

function isStatus(err: unknown, status: number): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === status
  );
}
