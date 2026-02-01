import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("difficulty-display")
export class DifficultyDisplay extends LitElement {
  @property({ type: String }) difficultyKey = "";

  createRenderRoot() {
    return this;
  }

  private getDifficultyIcon(difficultyKey: string) {
    const skull = html`<svg
      stroke="currentColor"
      fill="none"
      stroke-width="2"
      viewBox="0 0 24 24"
      stroke-linecap="round"
      stroke-linejoin="round"
      height="100%"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m12.5 17-.5-1-.5 1h1z"></path>
      <path
        d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"
      ></path>
      <circle cx="15" cy="12" r="1"></circle>
      <circle cx="9" cy="12" r="1"></circle>
    </svg>`;

    const burningSkull = html`<svg
      stroke="currentColor"
      fill="currentColor"
      stroke-width="0"
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      height="100%"
      width="100%"
    >
      <path
        d="M268.725 389.28l3.74 28.7h-30.89l3.74-28.7a11.705 11.705 0 1 1 23.41 0zm33.84-71.83a29.5 29.5 0 1 0 29.5 29.5 29.5 29.5 0 0 0-29.51-29.5zm-94.4 0a29.5 29.5 0 1 0 29.5 29.5 29.5 29.5 0 0 0-29.51-29.5zm245.71-62c0 98.2-48.22 182.68-117.39 220.24-46 28.26-112.77 28.26-156.19 2.5-71.72-36.21-122.17-122.29-122.17-222.73 0-78.16 30.54-147.63 77.89-191.67 0 0-42.08 82.86 9.1 135-11.67-173.77 169.28-63 118-184 151.79 83.33 9.14 105 84.1 148.21 0 0 66.21 47 36.4-91.73 42.95 43.99 70.25 110.3 70.25 184.19zm-68.54 29.87c-2.45-65.49-54.88-119.59-120.26-124.07-3.06-.21-6.15-.31-9.16-.31a129.4 129.4 0 0 0-129.43 129.35 132.15 132.15 0 0 0 24.51 76v25a35 35 0 0 0 34.74 34.69h6.26v16.61a34.66 34.66 0 0 0 34.71 34.39h61.78a34.48 34.48 0 0 0 34.51-34.39v-16.61h5.38a34.89 34.89 0 0 0 34.62-34.75v-28a129.32 129.32 0 0 0 22.33-77.9z"
      ></path>
    </svg>`;

    const questionMark = html`<svg
      stroke="currentColor"
      fill="currentColor"
      stroke-width="0"
      viewBox="0 0 24 24"
      height="100%"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="none" d="M0 0h24v24H0z"></path>
      <path
        d="M11.07 12.85c.77-1.39 2.25-2.21 3.11-3.44.91-1.29.4-3.7-2.18-3.7-1.69 0-2.52 1.28-2.87 2.34L6.54 6.96C7.25 4.83 9.18 3 11.99 3c2.35 0 3.96 1.07 4.78 2.41.7 1.15 1.11 3.3.03 4.9-1.2 1.77-2.35 2.31-2.97 3.45-.25.46-.35.76-.35 2.24h-2.89c-.01-.78-.13-2.05.48-3.15zM14 20c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z"
      ></path>
    </svg>`;

    const activeClass =
      "opacity-100 text-[#ff3838] drop-shadow-[0_0_4px_rgba(255,56,56,0.4)] transform group-hover:drop-shadow-[0_0_6px_rgba(255,56,56,0.6)] group-hover:-translate-y-[2px] -translate-y-[1px] transition-all duration-200";
    const inactiveClass = "opacity-30 w-4 h-4 transition-all duration-200";
    const bigClass = "w-10 h-10";
    const smallClass = "w-4 h-4";

    switch (difficultyKey) {
      case "Easy":
        return html`
          <div class="${smallClass} ${activeClass}">${skull}</div>
          <div class="${smallClass} ${inactiveClass}">${skull}</div>
          <div class="${smallClass} ${inactiveClass}">${skull}</div>
        `;
      case "Medium":
        return html`
          <div class="${smallClass} ${activeClass}">${skull}</div>
          <div class="${smallClass} ${activeClass}">${skull}</div>
          <div class="${smallClass} ${inactiveClass}">${skull}</div>
        `;
      case "Hard":
        return html`
          <div class="${smallClass} ${activeClass}">${skull}</div>
          <div class="${smallClass} ${activeClass}">${skull}</div>
          <div class="${smallClass} ${activeClass}">${skull}</div>
        `;
      case "Impossible":
        return html`
          <div class="${bigClass} ${activeClass}">${burningSkull}</div>
        `;
      default:
        return html`<div class="${bigClass} ${activeClass}">
          ${questionMark}
        </div>`;
    }
  }

  render() {
    return html`
      <div class="flex justify-center items-center h-10 gap-[6px] mt-1 group">
        ${this.getDifficultyIcon(this.difficultyKey)}
      </div>
    `;
  }
}
