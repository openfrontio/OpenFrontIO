import { classifyIssue, makeAnthropic } from "./claude";
import { MAX_CALLS_PER_RUN, RECENT_ISSUES_CONTEXT_SIZE, URLS } from "./config";
import { postToDiscord } from "./discord";
import {
  ensureAllLabels,
  getIssue,
  listOpenIssues,
  makeOctokit,
} from "./github";
import {
  decisionToActions,
  downgradeIfLowConfidence,
  isTriageCandidate,
  runTriagePass,
} from "./pass1-triage";
import { runDigestPass } from "./pass2-digest";

type ParsedArgs = {
  issueNumber: number | null;
  dryRunOverride: boolean | null;
};

function parseArgs(argv: string[]): ParsedArgs {
  let issueNumber: number | null = null;
  let dryRunOverride: boolean | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--issue") {
      const next = argv[i + 1];
      if (next) {
        const parsed = parseInt(next, 10);
        if (Number.isNaN(parsed)) {
          throw new Error(`--issue requires a numeric value, got: ${next}`);
        }
        issueNumber = parsed;
      }
      i++;
    } else if (arg === "--dry-run") {
      dryRunOverride = true;
    } else if (arg === "--no-dry-run") {
      dryRunOverride = false;
    }
  }
  return { issueNumber, dryRunOverride };
}

/**
 * Refuse to run live if any URL in config.ts is still a TODO_ placeholder.
 * Catches the failure mode where a redirect comment renders the literal
 * placeholder string as a link in the public issue.
 */
function assertConfigReadyForLiveRun(): void {
  const placeholders: string[] = [];
  for (const [key, value] of Object.entries(URLS)) {
    if (typeof value === "string" && value.startsWith("TODO_")) {
      placeholders.push(key);
    }
  }
  if (placeholders.length > 0) {
    throw new Error(
      `Refusing to run live: unfilled URL placeholders in config.ts: ${placeholders.join(", ")}. Set the real values before running with --no-dry-run.`,
    );
  }
}

function resolveDryRun(cliFlag: boolean | null, fromCli: boolean): boolean {
  if (cliFlag !== null) return cliFlag;
  if (fromCli) return true;
  return (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
}

async function singleIssueMode(args: {
  issueNumber: number;
  dryRun: boolean;
  githubToken: string;
  anthropicKey: string;
}): Promise<void> {
  const octokit = makeOctokit(args.githubToken);
  const anthropic = makeAnthropic(args.anthropicKey);

  console.log(
    `[claude-cron] single-issue mode — issue #${args.issueNumber} (dry_run=${args.dryRun})`,
  );

  const issue = await getIssue(octokit, args.issueNumber);
  if (!issue) {
    console.error(`[claude-cron] issue #${args.issueNumber} not found`);
    process.exit(1);
  }
  if (!isTriageCandidate(issue)) {
    console.log(
      `[claude-cron] issue #${args.issueNumber} is not a triage candidate — state=${issue.state}, labels=${issue.labels.join(",")}, assoc=${issue.author_association}, is_pr=${issue.is_pull_request}`,
    );
    return;
  }

  const allOpen = await listOpenIssues(octokit);
  const contextIssues = allOpen.slice(0, RECENT_ISSUES_CONTEXT_SIZE);

  const result = await classifyIssue(anthropic, issue, contextIssues);
  console.log(
    `[claude-cron] tokens in=${result.usage.input_tokens} out=${result.usage.output_tokens}`,
  );
  const decision = downgradeIfLowConfidence(result.value);
  console.log(`[claude-cron] decision:`, JSON.stringify(decision, null, 2));

  const actions = decisionToActions(decision, issue);
  console.log(
    `[claude-cron] would apply: ${actions.map((a) => a.type + (a.type === "add_label" || a.type === "remove_label" ? `(${a.label})` : "")).join(", ")}`,
  );

  if (args.dryRun) {
    console.log(`[claude-cron] DRY_RUN: no actions applied`);
    return;
  }
  await ensureAllLabels(octokit);
  // Import here to avoid pulling the apply path into the dry-run hot path.
  const { applyActions } = await import("./github");
  await applyActions(octokit, args.issueNumber, actions);
  console.log(`[claude-cron] applied ${actions.length} actions`);
}

async function fullCronMode(args: {
  dryRun: boolean;
  githubToken: string;
  anthropicKey: string;
  discordWebhookUrl: string | null;
}): Promise<void> {
  const octokit = makeOctokit(args.githubToken);
  const anthropic = makeAnthropic(args.anthropicKey);

  console.log(`[claude-cron] starting cron (dry_run=${args.dryRun})`);

  if (!args.dryRun) await ensureAllLabels(octokit);

  const now = new Date();

  const triagePass = await runTriagePass(octokit, anthropic, {
    dryRun: args.dryRun,
  });
  console.log(
    `[claude-cron] triage pass — processed=${triagePass.processed} closed=${triagePass.closed} kept=${triagePass.kept} calls=${triagePass.callCount}`,
  );

  const remainingCalls = Math.max(0, MAX_CALLS_PER_RUN - triagePass.callCount);
  const digestResult = await runDigestPass({
    octokit,
    anthropic,
    triagePass,
    now,
    dryRun: args.dryRun,
    remainingClaudeCalls: remainingCalls,
  });
  console.log(
    `[claude-cron] digest pass — pr_review_calls=${digestResult.prReviewCallCount} composed_by_claude=${digestResult.composedByClaude} posted=${digestResult.posted}`,
  );

  if (!args.dryRun && args.discordWebhookUrl) {
    try {
      await postToDiscord(args.discordWebhookUrl, digestResult.markdown);
      console.log(`[claude-cron] digest posted to Discord webhook`);
    } catch (err) {
      console.error(`[claude-cron] Discord post failed: ${err}`);
    }
  } else if (args.dryRun && args.discordWebhookUrl) {
    console.log(`[claude-cron] DRY_RUN: would post digest to Discord webhook`);
  }

  console.log(`[claude-cron] done`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cliInvocation =
    args.dryRunOverride !== null || args.issueNumber !== null;
  const dryRun = resolveDryRun(args.dryRunOverride, cliInvocation);

  if (!dryRun) assertConfigReadyForLiveRun();

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error("GITHUB_TOKEN env var is required");
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY env var is required");
  const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL ?? null;

  if (args.issueNumber !== null) {
    await singleIssueMode({
      issueNumber: args.issueNumber,
      dryRun,
      githubToken,
      anthropicKey,
    });
    return;
  }

  await fullCronMode({
    dryRun,
    githubToken,
    anthropicKey,
    discordWebhookUrl,
  });
}

main().catch((err) => {
  console.error("[claude-cron] Unexpected error:", err);
  process.exit(1);
});
