import { translateText } from "../../../Utils";

// Shared date helpers for paginated game-history lists (clan + player). Kept
// generic over `{ start }` so both the clan and player history views can group
// and label rows identically without duplicating the timezone/formatting logic.

export type DayGroup<T> = { day: string; items: T[] };

// Groups rows by their local-day key while preserving server order. Server
// ordering is already newest-first, so within a group we keep arrival order.
export function groupByDay<T extends { start: string }>(
  items: T[],
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const day = dayKey(item.start);
    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      last.items.push(item);
    } else {
      groups.push({ day, items: [item] });
    }
  }
  return groups;
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  // Local-time YYYY-MM-DD so headers line up with the user's clock, not UTC
  // midnight (which would split late-night games into a "next day" group for
  // most timezones).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Indexed by Date.getMonth() (0–11). Kept as a const list rather than a switch
// so the translation pipeline picks up every key from a single place.
const MONTH_KEYS = [
  "common.month_jan",
  "common.month_feb",
  "common.month_mar",
  "common.month_apr",
  "common.month_may",
  "common.month_jun",
  "common.month_jul",
  "common.month_aug",
  "common.month_sep",
  "common.month_oct",
  "common.month_nov",
  "common.month_dec",
] as const;

export function formatDayHeader(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return day;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (today.getTime() - dayStart.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return translateText("clan_modal.history_today");
  if (diffDays === 1) return translateText("clan_modal.history_yesterday");
  // "17 May 2026" — weekday dropped (no translation coverage). The month uses
  // our own translation keys, and the whole day/month/year template goes
  // through a key too so other locales can reorder it (e.g. "May 17, 2026").
  // day/year are passed as strings so ICU doesn't apply number grouping to the
  // year (e.g. "2,026").
  const month = translateText(MONTH_KEYS[d.getMonth()]);
  return translateText("clan_modal.history_date_full", {
    day: String(d.getDate()),
    month,
    year: String(d.getFullYear()),
  });
}

export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return translateText("clan_modal.history_today_at", { time });
  }
  // Join the localized date and time through a key so locales control the
  // order/separator (parallels history_today_at).
  return translateText("clan_modal.history_date_at", {
    date: date.toLocaleDateString(),
    time,
  });
}
