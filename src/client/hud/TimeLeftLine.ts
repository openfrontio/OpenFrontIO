import { html } from "lit";

// A 2px line along the bottom edge of its positioned parent that drains as the
// time left runs out. Callers set the fraction on every tick and the 100 ms
// linear transition glides between ticks. Under reduced motion it is not
// drawn: the seconds shown next to it carry the same information.
const LINE =
  "pointer-events-none absolute bottom-0 start-0 h-0.5 w-(--time-left) bg-yellow-400 transition-[width] duration-100 ease-linear motion-reduce:hidden";

export function timeLeftLine(fraction: number) {
  const left = Math.min(Math.max(fraction, 0), 1);
  return html`<span
    aria-hidden="true"
    data-time-left=${left}
    class=${LINE}
    style=${`--time-left: ${left * 100}%`}
  ></span>`;
}
