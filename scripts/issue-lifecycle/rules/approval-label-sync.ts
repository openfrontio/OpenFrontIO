import { LABELS } from "../config";
import { type Action, hasLabel, type Issue } from "../github";

export function syncApprovalLabel(issue: Issue): Action[] {
  const hasApproved = hasLabel(issue, LABELS.APPROVED);
  const hasNotApproved = hasLabel(issue, LABELS.NOT_APPROVED);
  const milestoned = issue.milestone !== null;
  const actions: Action[] = [];

  if (milestoned) {
    if (!hasApproved) {
      actions.push({ type: "add_label", label: LABELS.APPROVED });
    }
    if (hasNotApproved) {
      actions.push({ type: "remove_label", label: LABELS.NOT_APPROVED });
    }
  } else {
    if (!hasNotApproved) {
      actions.push({ type: "add_label", label: LABELS.NOT_APPROVED });
    }
    if (hasApproved) {
      actions.push({ type: "remove_label", label: LABELS.APPROVED });
    }
  }
  return actions;
}
