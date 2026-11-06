// Dates here are UTC days from the API. A season changes at midnight UTC, the
// same for every player, so nothing here reads the viewer's timezone.

const MS_PER_DAY = 86_400_000;

const dayOf = (date: Date): number => Math.floor(date.getTime() / MS_PER_DAY);
const dayOfIso = (iso: string): number => dayOf(new Date(`${iso}T00:00:00Z`));

/** How far through a season `now` is. Its first and last days both count. */
export function seasonTiming(
  startDate: string,
  endDate: string,
  now: Date,
): { daysLeft: number; progress: number } {
  const start = dayOfIso(startDate);
  const end = dayOfIso(endDate);
  // The API sends a season only while it's running, so a day outside it means
  // the viewer's clock is wrong: stay in range.
  const today = Math.min(end, Math.max(start, dayOf(now)));
  return {
    daysLeft: end - today,
    progress: (today - start + 1) / (end - start + 1),
  };
}

/** A season date in the viewer's locale, e.g. "9 Nov" or "20 Dec 2026". */
export function formatSeasonDate(iso: string, withYear = false): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
}
