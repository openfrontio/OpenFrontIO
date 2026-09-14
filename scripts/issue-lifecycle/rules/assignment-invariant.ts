import { COMMENTS } from "../config";
import type { Action, Issue } from "../github";

export function enforceAssignmentInvariant(issue: Issue): Action[] {
  if (issue.milestone !== null) return [];
  if (issue.assignees.length === 0) return [];

  const users = issue.assignees.map((a) => a.login);
  return [
    { type: "unassign", users },
    { type: "comment", body: COMMENTS.UNASSIGNED_NO_MILESTONE(users) },
  ];
}
