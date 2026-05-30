import { runCron } from "./cron";
import { runEvent } from "./events";
import { ensureAllLabels, makeOctokit } from "./github";

type ParsedArgs = {
  mode: "cron" | "event" | null;
  issueNumber: number | null;
  dryRunOverride: boolean | null;
};

function parseArgs(argv: string[]): ParsedArgs {
  let mode: "cron" | "event" | null = null;
  let issueNumber: number | null = null;
  let dryRunOverride: boolean | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode") {
      const next = argv[i + 1];
      if (next === "cron" || next === "event") mode = next;
      i++;
    } else if (arg === "--issue") {
      const next = argv[i + 1];
      if (next) issueNumber = parseInt(next, 10);
      i++;
    } else if (arg === "--dry-run") {
      dryRunOverride = true;
    } else if (arg === "--no-dry-run") {
      dryRunOverride = false;
    }
  }
  return { mode, issueNumber, dryRunOverride };
}

function resolveDryRun(cliFlag: boolean | null, fromCli: boolean): boolean {
  if (cliFlag !== null) return cliFlag;
  if (fromCli) return true;
  return (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.mode === null) {
    throw new Error("--mode <cron|event> is required");
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var is required");

  const cliInvocation =
    args.dryRunOverride !== null || args.issueNumber !== null;
  const dryRun = resolveDryRun(args.dryRunOverride, cliInvocation);

  const octokit = makeOctokit(token);

  if (!dryRun) await ensureAllLabels(octokit);

  if (args.mode === "cron") {
    console.log(`[issue-lifecycle] starting cron sweep (dry_run=${dryRun})`);
    await runCron(octokit, dryRun);
    return;
  }

  const issueNumber =
    args.issueNumber ?? parseInt(process.env.ISSUE_NUMBER ?? "", 10);
  if (!issueNumber || Number.isNaN(issueNumber)) {
    throw new Error(
      "Issue number missing — set ISSUE_NUMBER env or pass --issue <number>",
    );
  }
  const eventName = process.env.EVENT_NAME ?? "";
  if (!eventName) {
    throw new Error("EVENT_NAME env var is required in event mode");
  }

  console.log(
    `[issue-lifecycle] event "${eventName}" on issue #${issueNumber} (dry_run=${dryRun})`,
  );
  await runEvent(octokit, eventName, issueNumber, dryRun);
}

main().catch((err) => {
  console.error("[issue-lifecycle] Unexpected error:", err);
  process.exit(1);
});
