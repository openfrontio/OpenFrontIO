export const REPO = { owner: "openfrontio", repo: "OpenFrontIO" } as const;

export const STALE_WARN_DAYS = 7;
export const STALE_CLOSE_DAYS = 14;

export const LABELS = {
  NOT_APPROVED: "not-approved",
  APPROVED: "approved",
  STALE: "stale",
  KEEP_OPEN: "keep-open",
  NEEDS_INFO: "needs-info",
  AUTO_CLOSED_STALE: "auto-closed-stale",
} as const;

export const LABEL_COLORS: Record<string, string> = {
  [LABELS.NOT_APPROVED]: "B60205",
  [LABELS.APPROVED]: "0E8A16",
  [LABELS.STALE]: "BFD4F2",
  [LABELS.KEEP_OPEN]: "FFFFFF",
  [LABELS.NEEDS_INFO]: "FBCA04",
  [LABELS.AUTO_CLOSED_STALE]: "586069",
};

export const LABEL_DESCRIPTIONS: Record<string, string> = {
  [LABELS.NOT_APPROVED]: `Not yet approved by maintainer; will auto-close after ${STALE_CLOSE_DAYS} days if no milestone is set`,
  [LABELS.APPROVED]: "Maintainer has assigned a milestone — work is approved",
  [LABELS.STALE]: `No activity recently; will auto-close in ${STALE_CLOSE_DAYS - STALE_WARN_DAYS} days unless updated`,
  [LABELS.KEEP_OPEN]: "Exempt from auto-close",
  [LABELS.NEEDS_INFO]:
    "Reporter was asked for more info; no special timer — standard stale-close still applies",
  [LABELS.AUTO_CLOSED_STALE]: "Closed automatically due to inactivity",
};

export const COMMENTS = {
  STALE_WARNING: (author: string): string =>
    `Hi @${author}, this issue hasn't had activity in ${STALE_WARN_DAYS} days and doesn't yet have a milestone assigned.

If a maintainer doesn't milestone this issue (or you don't update it) within the next ${STALE_CLOSE_DAYS - STALE_WARN_DAYS} days, it will be **automatically closed**.

If you believe this issue is important, consider:
- Adding more context, repro steps, or examples
- Discussing in our [Discord](https://discord.gg/K9zernJB5z)
- Requesting the \`${LABELS.KEEP_OPEN}\` label if it should be exempt from auto-close

— *Automated. See [CONTRIBUTING.md](https://github.com/${REPO.owner}/${REPO.repo}/blob/main/CONTRIBUTING.md).*`,

  AUTO_CLOSED_STALE: (author: string): string =>
    `Closing this issue as it hasn't been milestoned and has had no recent activity.

This isn't a judgment of the issue's merit — just routine triage. @${author}, if you believe this should be reconsidered, please reopen with additional context or discuss in [Discord](https://discord.gg/K9zernJB5z).

— *Automated.*`,

  NEW_ISSUE_NOT_APPROVED: (author: string): string =>
    `Hi @${author}, thanks for opening this issue. It hasn't been approved by a maintainer yet — we'll get back to you shortly to either milestone it (approval) or close it.

— *Automated. See [CONTRIBUTING.md](https://github.com/${REPO.owner}/${REPO.repo}/blob/main/CONTRIBUTING.md).*`,

  UNASSIGNED_NO_MILESTONE: (assignees: string[]): string =>
    `${assignees.map((u) => "@" + u).join(", ")} — you've been unassigned from this issue automatically because it doesn't have a milestone set.

In OpenFront's workflow, an issue must have a milestone (\`backlog\` or a version like \`v30\`) before anyone can be assigned. This ensures only approved work has people working on it.

If this is approved work, a maintainer needs to milestone the issue first, then re-assign you.

— *Automated. See [CONTRIBUTING.md](https://github.com/${REPO.owner}/${REPO.repo}/blob/main/CONTRIBUTING.md).*`,
} as const;
