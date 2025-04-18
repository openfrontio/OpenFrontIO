import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("stats-marquee")
export class StatsMarquee extends LitElement {
  static styles = css`
    .marquee-container {
      display: flex;
      border-radius: 0.15rem;
      align-items: center;
      width: 100%;
      background-color: #fff;
      overflow: hidden;
      box-sizing: border-box;
    }

    .label {
      flex-shrink: 0;
      padding: 0 1rem;
      font-color: var(--fontColor);
      background-color: var(--secondaryColor);
    }

    .marquee {
      overflow: hidden;
      white-space: nowrap;
      flex-grow: 1;
    }

    .marquee-text {
      display: inline-block;
      padding-left: 100%;
      animation: scroll-left 7.5s linear infinite;
      color: var(--fontColor);
    }

    @keyframes scroll-left {
      from {
        transform: translateX(100%);
      }
      to {
        transform: translateX(-100%);
      }
    }
  `;

  render() {
    return html`
      <div class="marquee-container">
        <div class="label">Fun Facts:</div>
        <div class="marquee">
          <span class="marquee-text">1 nukes launched</span>
        </div>
      </div>
    `;
  }
}
