import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

export enum DifficultyDescription {
  Easy = "Relaxed",
  Medium = "Balanced",
  Hard = "Intense",
  Impossible = "Impossible",
}

@customElement("difficulty-display")
export class DifficultyDisplay extends LitElement {
  @property({ type: String }) difficultyKey = "";

  static styles = css`
    .difficulty-indicator {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 40px;
      gap: 6px;
      margin: 4px 0 0 0;
    }

    .difficulty-skull {
      width: 16px;
      height: 16px;
      opacity: 0.3;
      transition: all 0.2s ease;
    }

    .difficulty-skull.big {
      width: 40px;
      height: 40px;
    }

    .difficulty-skull.active {
      opacity: 1;
      color: #ff3838;
      filter: drop-shadow(0 0 4px rgba(255, 56, 56, 0.4));
      transform: translateY(-1px);
    }

    :host(:hover) .difficulty-skull.active {
      filter: drop-shadow(0 0 6px rgba(255, 56, 56, 0.6));
      transform: translateY(-2px);
    }
  `;

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

    const kingSkull = html`<svg
      stroke="currentColor"
      fill="currentColor"
      stroke-width="0"
      viewBox="0 0 512 512"
      height="100%"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M92.406 13.02l-.164 156.353c3.064.507 6.208 1.38 9.39 2.627 36.496 14.306 74.214 22.435 111.864 25.473l43.402-60.416 42.317 58.906c36.808-4.127 72.566-12.502 105.967-24.09 3.754-1.302 7.368-2.18 10.818-2.6l1.523-156.252-75.82 95.552-34.084-95.55-53.724 103.74-53.722-103.74-35.442 95.55-72.32-95.55h-.006zm164.492 156.07l-28.636 39.86 28.634 39.86 28.637-39.86-28.635-39.86zM86.762 187.55c-2.173-.08-3.84.274-5.012.762-2.345.977-3.173 2.19-3.496 4.196-.645 4.01 2.825 14.35 23.03 21.36 41.7 14.468 84.262 23.748 126.778 26.833l-17.75-24.704c-38.773-3.285-77.69-11.775-115.5-26.596-3.197-1.253-5.877-1.77-8.05-1.85zm333.275.19c-2.156.052-5.048.512-8.728 1.79-33.582 11.65-69.487 20.215-106.523 24.646l-19.264 26.818c40.427-2.602 80.433-11.287 119.22-26.96 15.913-6.43 21.46-17.81 21.36-22.362-.052-2.276-.278-2.566-1.753-3.274-.738-.353-2.157-.71-4.313-.658zm-18.117 47.438c-42.5 15.87-86.26 23.856-130.262 25.117l-14.76 20.547-14.878-20.71c-44.985-1.745-89.98-10.23-133.905-24.306-12.78 28.51-18.94 61.14-19.603 93.44 37.52 17.497 62.135 39.817 75.556 64.63C177 417.8 179.282 443.62 174.184 467.98c7.72 5.007 16.126 9.144 24.98 12.432l5.557-47.89 18.563 2.154-5.935 51.156c9.57 2.21 19.443 3.53 29.377 3.982v-54.67h18.69v54.49c9.903-.638 19.705-2.128 29.155-4.484l-5.857-50.474 18.564-2.155 5.436 46.852c8.747-3.422 17.004-7.643 24.506-12.69-5.758-24.413-3.77-49.666 9.01-72.988 13.28-24.234 37.718-46 74.803-64.29-.62-33.526-6.687-66.122-19.113-94.23zm-266.733 47.006c34.602.23 68.407 12.236 101.358 36.867-46.604 33.147-129.794 34.372-108.29-36.755 2.315-.09 4.626-.127 6.933-.11zm242.825 0c2.307-.016 4.617.022 6.93.11 21.506 71.128-61.684 69.903-108.288 36.757 32.95-24.63 66.756-36.637 101.358-36.866zM255.164 332.14c11.77 21.725 19.193 43.452 25.367 65.178h-50.737c4.57-21.726 13.77-43.45 25.37-65.18z"
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

    switch (difficultyKey) {
      case "Easy":
        return html`
          <div class="difficulty-skull active">${skull}</div>
          <div class="difficulty-skull">${skull}</div>
          <div class="difficulty-skull">${skull}</div>
        `;
      case "Medium":
        return html`
          <div class="difficulty-skull active">${skull}</div>
          <div class="difficulty-skull active">${skull}</div>
          <div class="difficulty-skull">${skull}</div>
        `;
      case "Hard":
        return html`
          <div class="difficulty-skull active">${skull}</div>
          <div class="difficulty-skull active">${skull}</div>
          <div class="difficulty-skull active">${skull}</div>
        `;
      case "Impossible":
        return html`
          <div class="difficulty-skull big active">${burningSkull}</div>
        `;
      default:
        return html`<div class="difficulty-skull big active">
          ${questionMark}
        </div>`;
    }
  }

  render() {
    return html`
      <div class="difficulty-indicator">
        ${this.getDifficultyIcon(this.difficultyKey)}
      </div>
    `;
  }
}
