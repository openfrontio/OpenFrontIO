import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

/** "Ends in 2d 5h", "Ends in 3h 12m" or "Ends in 8m" until a sale ends. */
export function saleEndsIn(endsAt: string, now: number = Date.now()): string {
  const totalMinutes = Math.max(
    Math.ceil((new Date(endsAt).getTime() - now) / 60_000),
    1,
  );
  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 24) {
    return translateText("store.sale_ends_in_days", {
      days: Math.floor(hours / 24),
      hours: hours % 24,
    });
  }
  if (hours > 0) {
    return translateText("store.sale_ends_in_hours", {
      hours,
      minutes: totalMinutes % 60,
    });
  }
  return translateText("store.sale_ends_in_minutes", {
    minutes: totalMinutes,
  });
}

/** "1:23:45" (or "23:45" under an hour) until `endsAt`; "0:00" once past. */
export function clockUntil(endsAt: string, now: number = Date.now()): string {
  const total = Math.max(
    Math.ceil((new Date(endsAt).getTime() - now) / 1000),
    0,
  );
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

/**
 * Time left on a sale, ticking on its own so the store around it doesn't
 * re-render: "Ends in 2d 5h" every half minute, or a "1:23:45" clock every
 * second for a flash sale's short slots.
 */
@customElement("sale-countdown")
export class SaleCountdown extends LitElement {
  @property({ type: String })
  endsAt = "";

  @property({ type: String })
  format: "ends-in" | "clock" = "ends-in";

  private timer: ReturnType<typeof setInterval> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.restartTimer();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("format")) this.restartTimer();
  }

  private restartTimer() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = setInterval(
      () => this.requestUpdate(),
      this.format === "clock" ? 1000 : 30_000,
    );
  }

  render() {
    if (!this.endsAt) return html``;
    return this.format === "clock"
      ? clockUntil(this.endsAt)
      : saleEndsIn(this.endsAt);
  }
}
