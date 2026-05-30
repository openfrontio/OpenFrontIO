export const REPO = { owner: "openfrontio", repo: "OpenFrontIO" } as const;

export const MAINTAINER_LOGIN = "evanpelle";

export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const MAX_CALLS_PER_RUN = 100;
export const RECENT_ISSUES_CONTEXT_SIZE = 50;
export const DIGEST_LOOKBACK_HOURS = 24;

// TODO(maintainer): create a tracking issue, pin it, and set its number here.
// Until set, the digest is logged to stdout instead of posted.
export const DIGEST_ISSUE_NUMBER = 0;

// Toggle to false to let translation issues stay open with `claude-uncertain`
// instead of being auto-closed and redirected to Crowdin.
export const ENABLE_TRANSLATION_CLOSE = true;

export const URLS = {
  DEV_DISCORD: "https://discord.gg/K9zernJB5z",
  GAME_DISCORD: "https://discord.gg/openfront",
  CROWDIN: "https://crowdin.com/project/openfront-mls",
  SECURITY_EMAIL: "security@openfront.io",
  BILLING_EMAIL: "support@openfront.io",
} as const;

// Labels managed by THIS Action — Claude only applies these.
export const LABELS = {
  CLAUDE_TRIAGED: "claude-triaged",
  CLAUDE_APPROVED: "claude-approved",
  CLAUDE_UNCERTAIN: "claude-uncertain",
  BUG: "bug",
  QOL_IMPROVEMENT: "qol-improvement",
  POSSIBLE_DUPLICATE: "possible-duplicate",
  NEEDS_INFO: "needs-info", // shared with Layer A
  AUTO_CLOSED_FEATURE: "auto-closed-feature",
  AUTO_CLOSED_QUESTION: "auto-closed-question",
  AUTO_CLOSED_SUPPORT: "auto-closed-support",
  AUTO_CLOSED_BILLING: "auto-closed-billing",
  AUTO_CLOSED_TRANSLATION: "auto-closed-translation",
  AREA_CLIENT: "area:client",
  AREA_CORE: "area:core",
  AREA_SERVER: "area:server",
  AREA_MAP_GENERATOR: "area:map-generator",
  AREA_OTHER: "area:other",
} as const;

// Labels Layer A owns. This Action MUST NOT add or remove these.
// Enforced as a runtime assertion in applyDecision.
export const FORBIDDEN_LABELS: ReadonlySet<string> = new Set([
  "approved",
  "not-approved",
  "stale",
  "keep-open",
  "auto-closed-stale",
]);

// Layer A label names referenced for digest fetches (read-only).
export const LAYER_A_LABELS = {
  STALE: "stale",
  NOT_APPROVED: "not-approved",
} as const;

// Note: `security` is intentionally NOT in this list. Closing a GitHub issue
// doesn't make its content private — it stays publicly indexed. Auto-closing
// a security report with a "thanks, please file privately" comment would
// only draw more attention to a still-public exploit description. Instead,
// `security` is routed to `claude-uncertain` so the maintainer can manually
// delete, contact the reporter privately, or process it discreetly.
export const AUTO_CLOSE_CLASSIFICATIONS = [
  "feature",
  "question",
  "support",
  "billing",
  "translation",
] as const;
export type AutoCloseClassification =
  (typeof AUTO_CLOSE_CLASSIFICATIONS)[number];

export const ALL_CLASSIFICATIONS = [
  "bug",
  "qol-improvement",
  "duplicate",
  "needs-info",
  "feature",
  "question",
  "support",
  "billing",
  "security",
  "translation",
  "uncertain",
] as const;
export type Classification = (typeof ALL_CLASSIFICATIONS)[number];

export const AREA_LABELS = [
  LABELS.AREA_CLIENT,
  LABELS.AREA_CORE,
  LABELS.AREA_SERVER,
  LABELS.AREA_MAP_GENERATOR,
  LABELS.AREA_OTHER,
] as const;
export type AreaLabel = (typeof AREA_LABELS)[number];

export const LABEL_COLORS: Record<string, string> = {
  [LABELS.CLAUDE_TRIAGED]: "EEEEEE",
  [LABELS.CLAUDE_APPROVED]: "0E70B0",
  [LABELS.CLAUDE_UNCERTAIN]: "5319E7",
  [LABELS.BUG]: "D93F0B",
  [LABELS.QOL_IMPROVEMENT]: "1D76DB",
  [LABELS.POSSIBLE_DUPLICATE]: "FEF2C0",
  [LABELS.NEEDS_INFO]: "FBCA04",
  [LABELS.AUTO_CLOSED_FEATURE]: "586069",
  [LABELS.AUTO_CLOSED_QUESTION]: "586069",
  [LABELS.AUTO_CLOSED_SUPPORT]: "586069",
  [LABELS.AUTO_CLOSED_BILLING]: "586069",
  [LABELS.AUTO_CLOSED_TRANSLATION]: "586069",
  [LABELS.AREA_CLIENT]: "C5DEF5",
  [LABELS.AREA_CORE]: "C5DEF5",
  [LABELS.AREA_SERVER]: "C5DEF5",
  [LABELS.AREA_MAP_GENERATOR]: "C5DEF5",
  [LABELS.AREA_OTHER]: "C5DEF5",
};

export const LABEL_DESCRIPTIONS: Record<string, string> = {
  [LABELS.CLAUDE_TRIAGED]:
    "Claude has run triage on this issue (idempotency marker)",
  [LABELS.CLAUDE_APPROVED]:
    "Claude confidently classified this as actionable bug or QoL — ready for maintainer milestone decision",
  [LABELS.CLAUDE_UNCERTAIN]:
    "Claude was not confident enough to classify — maintainer needs to triage manually",
  [LABELS.BUG]: "Reproducible defect in existing functionality",
  [LABELS.QOL_IMPROVEMENT]:
    "Small-scope improvement; completable by one contributor in under a week",
  [LABELS.POSSIBLE_DUPLICATE]:
    "Claude suggested this may duplicate another issue — maintainer confirms",
  [LABELS.NEEDS_INFO]:
    "Reporter was asked for more info; no special timer — standard stale-close still applies",
  [LABELS.AUTO_CLOSED_FEATURE]:
    "Closed automatically as a feature request from external contributor",
  [LABELS.AUTO_CLOSED_QUESTION]:
    "Closed automatically as a developer question — redirected to Dev Discord",
  [LABELS.AUTO_CLOSED_SUPPORT]:
    "Closed automatically as a player support request — redirected to Game Discord",
  [LABELS.AUTO_CLOSED_BILLING]:
    "Closed automatically as a billing matter — redirected to support email",
  [LABELS.AUTO_CLOSED_TRANSLATION]:
    "Closed automatically as a translation matter — redirected to Crowdin",
  [LABELS.AREA_CLIENT]:
    "Best-guess area: client (rendering, UI, web components)",
  [LABELS.AREA_CORE]: "Best-guess area: core simulation",
  [LABELS.AREA_SERVER]: "Best-guess area: game server",
  [LABELS.AREA_MAP_GENERATOR]: "Best-guess area: map generator",
  [LABELS.AREA_OTHER]: "Best-guess area: unclear or outside main components",
};

const AUTOMATION_FOOTER = "— *Automated by Claude triage.*";

export const COMMENTS = {
  AUTO_CLOSED_FEATURE: (
    author: string,
  ): string => `Hi @${author}, thanks for the suggestion.

OpenFront doesn't accept feature suggestions as GitHub issues from external contributors. Feature ideas are discussed in our [Dev Discord](${URLS.DEV_DISCORD}) first — if a maintainer thinks the idea is worth pursuing, they'll create the tracking issue.

Please join the Discord and post your idea there.

If you believe this was misclassified — for example, it's actually a bug or a small quality-of-life improvement to existing functionality — please reopen with more detail.

See [CONTRIBUTING.md](https://github.com/${REPO.owner}/${REPO.repo}/blob/main/CONTRIBUTING.md) for the full process.

${AUTOMATION_FOOTER}`,

  AUTO_CLOSED_QUESTION: (author: string): string => `Hi @${author},

Development and contributor questions are handled in our [Dev Discord](${URLS.DEV_DISCORD}), not on the issue tracker. You'll get a faster response there.

If you intended to report a bug rather than ask a question, please reopen with repro steps.

${AUTOMATION_FOOTER}`,

  AUTO_CLOSED_SUPPORT: (author: string): string => `Hi @${author},

For player support — bugs you're experiencing in-game, connectivity issues, reporting players, account problems — please open a ticket in our [Game Discord](${URLS.GAME_DISCORD}). The community and moderators can help much faster than the issue tracker.

If you've identified a specific reproducible defect (specific steps that always trigger the same broken behavior), please reopen with those details.

${AUTOMATION_FOOTER}`,

  AUTO_CLOSED_BILLING: (author: string): string => `Hi @${author},

For anything related to purchases, subscriptions, refunds, premium accounts, or billing — please email ${URLS.BILLING_EMAIL}. We can't process billing issues through GitHub.

${AUTOMATION_FOOTER}`,

  AUTO_CLOSED_TRANSLATION: (author: string): string => `Hi @${author},

Translation issues — text errors, requests for new languages, localization corrections — are handled through Crowdin, not the GitHub issue tracker.

Please visit [our Crowdin project](${URLS.CROWDIN}) to suggest fixes or join a translation team.

${AUTOMATION_FOOTER}`,

  POSSIBLE_DUPLICATE: (
    author: string,
    duplicateOf: number,
  ): string => `Hi @${author},

This issue looks like it might be a duplicate of #${duplicateOf}. A maintainer will confirm.

If you believe it's distinct from #${duplicateOf}, please leave a comment explaining the difference.

— *Automated by Claude triage. This is a suggestion, not a closure.*`,

  NEEDS_INFO: (author: string, questions: string[]): string => {
    const qList = questions.map((q) => `- ${q}`).join("\n");
    return `Hi @${author}, thanks for the report. To help us triage this, could you provide a bit more detail?

${qList}

Without this information, we may not be able to act on this issue.

${AUTOMATION_FOOTER}`;
  },
} as const;

export const CLOSE_COMMENT_BY_CLASSIFICATION: Record<
  AutoCloseClassification,
  (author: string) => string
> = {
  feature: COMMENTS.AUTO_CLOSED_FEATURE,
  question: COMMENTS.AUTO_CLOSED_QUESTION,
  support: COMMENTS.AUTO_CLOSED_SUPPORT,
  billing: COMMENTS.AUTO_CLOSED_BILLING,
  translation: COMMENTS.AUTO_CLOSED_TRANSLATION,
};

export const CLOSE_LABEL_BY_CLASSIFICATION: Record<
  AutoCloseClassification,
  string
> = {
  feature: LABELS.AUTO_CLOSED_FEATURE,
  question: LABELS.AUTO_CLOSED_QUESTION,
  support: LABELS.AUTO_CLOSED_SUPPORT,
  billing: LABELS.AUTO_CLOSED_BILLING,
  translation: LABELS.AUTO_CLOSED_TRANSLATION,
};
