import type { Octokit } from "@octokit/rest";
import {
  type Action,
  applyActions,
  describeAction,
  iterateOpenIssues,
} from "./github";
import { syncApprovalLabel } from "./rules/approval-label-sync";
import { enforceAssignmentInvariant } from "./rules/assignment-invariant";
import { checkStale } from "./rules/stale-closer";

export async function runCron(
  octokit: Octokit,
  dryRun: boolean,
): Promise<void> {
  const now = new Date();
  let issueCount = 0;
  let actedOnCount = 0;

  for await (const issue of iterateOpenIssues(octokit)) {
    issueCount++;
    const prefix = `[issue-lifecycle] issue #${issue.number}`;

    try {
      const stale = await checkStale(issue, octokit, now);
      if (stale.length > 0) {
        logActions(`${prefix} — rule: stale-closer`, stale);
        await maybeApply(octokit, issue.number, stale, dryRun, prefix);
        actedOnCount++;
      }

      const assignment = enforceAssignmentInvariant(issue);
      if (assignment.length > 0) {
        logActions(`${prefix} — rule: assignment-invariant`, assignment);
        await maybeApply(octokit, issue.number, assignment, dryRun, prefix);
        actedOnCount++;
      }

      const labelSync = syncApprovalLabel(issue);
      if (labelSync.length > 0) {
        logActions(`${prefix} — rule: approval-label-sync`, labelSync);
        await maybeApply(octokit, issue.number, labelSync, dryRun, prefix);
        actedOnCount++;
      }
    } catch (err) {
      console.error(`${prefix} — error: ${err}`);
    }
  }

  console.log(
    `[issue-lifecycle] cron sweep complete — issues scanned: ${issueCount}, rules triggered: ${actedOnCount}, dry_run: ${dryRun}`,
  );
}

function logActions(prefix: string, actions: Action[]): void {
  const summary = actions.map(describeAction).join(", ");
  console.log(`${prefix} — actions: ${summary}`);
}

async function maybeApply(
  octokit: Octokit,
  issueNumber: number,
  actions: Action[],
  dryRun: boolean,
  prefix: string,
): Promise<void> {
  if (dryRun) {
    console.log(`${prefix} — DRY_RUN: not applied`);
    return;
  }
  await applyActions(octokit, issueNumber, actions);
}
