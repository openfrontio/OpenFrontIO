import { html } from "lit";
import { DirectiveResult } from "lit/directive.js";
import { unsafeHTML, UnsafeHTMLDirective } from "lit/directives/unsafe-html.js";
import { GameEvent } from "./EventsDisplay";
import { onlyImages } from "../../../core/Util";

export function getEventDescription(
  event: GameEvent,
): string | DirectiveResult<typeof UnsafeHTMLDirective> {
  return event.unsafeDescription
    ? unsafeHTML(onlyImages(event.description))
    : event.description;
}

export function renderButton(options: {
  content: any;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  translate?: boolean;
  hidden?: boolean;
}) {
  const {
    content,
    onClick,
    className = "",
    disabled = false,
    translate = true,
    hidden = false,
  } = options;

  if (hidden) return html``;

  return html`
    <button
      class="${className}"
      @click=${onClick}
      ?disabled=${disabled}
      ?translate=${translate}
    >
      ${content}
    </button>
  `;
}

export function renderEventButtons(
  event: GameEvent,
  onRemoveEvent: (event: GameEvent) => void,
  requestUpdate: () => void
) {
  if (!event.buttons) return "";
  return html`
    <div class="flex flex-wrap gap-1.5 mt-1">
      ${event.buttons.map(
        (btn) => html`
          <button
            class="inline-block px-3 py-1 text-white rounded-sm text-md md:text-sm cursor-pointer transition-colors duration-300
              ${btn.className.includes("btn-info")
              ? "bg-blue-500 hover:bg-blue-600"
              : btn.className.includes("btn-gray")
                ? "bg-gray-500 hover:bg-gray-600"
                : "bg-green-600 hover:bg-green-700"}"
            @click=${() => {
              btn.action();
              if (!btn.preventClose) {
                onRemoveEvent(event);
              }
              requestUpdate();
            }}
          >
            ${btn.text}
          </button>
        `,
      )}
    </div>
  `;
}

export function renderEventContent(
  event: GameEvent,
  onFocusPlayer: (id: number) => void,
  onFocusUnit: (unit: any) => void,
  onRemoveEvent: (event: GameEvent) => void,
  requestUpdate: () => void
) {
  const description = event.focusID
    ? renderButton({
        content: getEventDescription(event),
        onClick: () => {
          if (event.focusID) onFocusPlayer(event.focusID);
        },
        className: "text-left",
      })
    : event.unitView
      ? renderButton({
          content: getEventDescription(event),
          onClick: () => {
            if (event.unitView) onFocusUnit(event.unitView);
          },
          className: "text-left",
        })
      : getEventDescription(event);

  return html`${description} ${renderEventButtons(event, onRemoveEvent, requestUpdate)}`;
}
