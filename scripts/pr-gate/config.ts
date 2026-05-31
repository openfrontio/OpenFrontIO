export const REPO = { owner: "openfrontio", repo: "OpenFrontIO" } as const;

export const TRUSTED_AUTHOR_ASSOCIATIONS = [
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
] as const;

export const SMALL_FIX_LINE_THRESHOLD = 50;

export const APPROVED_ISSUE_LABEL = "approved";

export const LABELS = {
  BYPASS: "bypass-pr-check",
  SMALL_FIX: "small-fix",
  AUTO_CLOSED: "auto-closed-needs-issue",
} as const;

export const LABEL_COLORS: Record<string, string> = {
  [LABELS.SMALL_FIX]: "0E8A16",
  [LABELS.AUTO_CLOSED]: "B60205",
};

export const LABEL_DESCRIPTIONS: Record<string, string> = {
  [LABELS.SMALL_FIX]: `Small fix (≤ ${SMALL_FIX_LINE_THRESHOLD} lines) — auto-applied by PR gate`,
  [LABELS.AUTO_CLOSED]: "PR closed by gate — see comment for next steps",
};

export const CLOSE_COMMENT = (author: string): string =>
  `Hi @${author}, thanks for the contribution.

This PR was automatically closed because it doesn't fit our contribution workflow:

- You aren't currently assigned to an issue labelled \`${APPROVED_ISSUE_LABEL}\`, **and**
- The change is larger than ${SMALL_FIX_LINE_THRESHOLD} lines (our cap for unsolicited contributions).

**To contribute to OpenFront:**

1. **For bugs or small quality-of-life improvements:** open an [issue](https://github.com/${REPO.owner}/${REPO.repo}/issues/new/choose). A maintainer will label it \`${APPROVED_ISSUE_LABEL}\` if it's something we'll work on.
2. **For feature ideas:** discuss in the [dev Discord](https://discord.gg/K9zernJB5z) first. We don't accept unsolicited feature PRs — even if they're good ideas, every merged feature is a permanent maintenance burden.
3. **Once an issue is labelled \`${APPROVED_ISSUE_LABEL}\`**, comment asking to be assigned. After you're assigned, you can open a PR referencing that issue.

If you believe this was closed in error, please reach out on our [Discord](https://discord.gg/K9zernJB5z) or comment below.

See [CONTRIBUTING.md](https://github.com/${REPO.owner}/${REPO.repo}/blob/main/CONTRIBUTING.md) for the full contribution process.

— *Automated PR gate. [Source](https://github.com/${REPO.owner}/${REPO.repo}/tree/main/scripts/pr-gate).*`;
