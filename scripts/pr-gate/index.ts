import { CLOSE_COMMENT, LABELS } from "./config";
import {
  addLabel,
  closePR,
  ensureLabel,
  getIssue,
  getPR,
  getPRFiles,
  getRepoPermission,
  makeOctokit,
  postComment,
} from "./github";
import { evaluate } from "./rules";

function parseArgs(argv: string[]): {
  prNumber: number | null;
  dryRunOverride: boolean | null;
} {
  let prNumber: number | null = null;
  let dryRunOverride: boolean | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pr") {
      const next = argv[i + 1];
      if (next) prNumber = parseInt(next, 10);
      i++;
    } else if (arg === "--dry-run") {
      dryRunOverride = true;
    } else if (arg === "--no-dry-run") {
      dryRunOverride = false;
    }
  }
  return { prNumber, dryRunOverride };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cliMode = args.prNumber !== null;

  const prNumber = args.prNumber ?? parseInt(process.env.PR_NUMBER ?? "", 10);
  if (!prNumber || Number.isNaN(prNumber)) {
    throw new Error(
      "PR number missing — set PR_NUMBER env or pass --pr <number>",
    );
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var is required");

  // CLI mode: always dry-run unless --no-dry-run is explicitly passed.
  // Workflow mode: read DRY_RUN env, default true.
  const dryRun = cliMode
    ? args.dryRunOverride !== false
    : (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

  const octokit = makeOctokit(token);

  const pr = await getPR(octokit, prNumber);
  const files = await getPRFiles(octokit, prNumber);

  const decision = await evaluate(
    pr,
    files,
    (n) => getIssue(octokit, n),
    (u) => getRepoPermission(octokit, u),
  );

  const prefix = `[pr-gate] PR #${prNumber}`;
  if (decision.action === "pass") {
    const labelNote = decision.labelToAdd
      ? ` — label: ${decision.labelToAdd}`
      : "";
    console.log(
      `${prefix} → decision: pass — reason: ${decision.reason}${labelNote}`,
    );
  } else {
    console.log(`${prefix} → decision: close — reason: ${decision.reason}`);
  }

  if (dryRun) {
    console.log(`${prefix} → DRY_RUN=true, no action taken`);
    return;
  }

  if (decision.action === "pass") {
    if (decision.labelToAdd) {
      await ensureLabel(octokit, decision.labelToAdd);
      await addLabel(octokit, prNumber, decision.labelToAdd);
    }
    return;
  }

  // Comment must land on an open PR — post before closing.
  await ensureLabel(octokit, LABELS.AUTO_CLOSED);
  await addLabel(octokit, prNumber, LABELS.AUTO_CLOSED);
  await postComment(octokit, prNumber, CLOSE_COMMENT(pr.user.login));
  await closePR(octokit, prNumber);
}

main().catch((err) => {
  console.error("[pr-gate] Unexpected error:", err);
  process.exit(1);
});
