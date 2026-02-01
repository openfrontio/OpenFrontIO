import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "./Utils";
import { BaseModal } from "./components/BaseModal";
import "./components/baseComponents/Modal";
import { modalHeader } from "./components/ui/ModalHeader";
import {
  collectGraphicsDiagnostics,
  GraphicsDiagnostics,
} from "./utilities/Diagnostic";
import infoIcon from "/images/InfoIcon.svg?url";

@customElement("troubleshooting-modal")
export class TroubleshootingModal extends BaseModal {
  @property({ type: String }) markdown = "Loading...";

  @property({ type: Object })
  diagnostics?: GraphicsDiagnostics;

  @property({ type: Boolean }) loading = true;

  private initialized: boolean = false;

  private async loadDiagnostics() {
    const canvas = document.createElement("canvas");
    this.diagnostics = await collectGraphicsDiagnostics(canvas);
    this.loading = false;
    this.initialized = true;
  }

  render() {
    const content = html`
      <div class="${this.modalContainerClass}">
        >
        ${modalHeader({
          titleContent: html` <div
            class="w-full flex flex-col sm:flex-row justify-between gap-2"
          >
            <span
              class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest break-words hyphens-auto"
            >
              <a
                class="hover:text-blue-200 text-blue-400 cursor-pointer"
                @click=${this.close}
                >${translateText("main.help")}</a
              >
              / ${translateText("troubleshooting.title")}
            </span>
            <button
              class="hover:bg-white/5 px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]"
              @click=${this.copyDiagnostics}
            >
              ${translateText("common.copy")}
            </button>
          </div>`,
          onBack: this.close,
          ariaLabel: translateText("common.back"),
        })}
        ${this.loading
          ? ""
          : html`
              <div
                class="flex-1 overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent mr-1"
              >
                ${this.section(
                  "",
                  html`${this.infoTip(
                    translateText("troubleshooting.hardware_acceleration_tip"),
                    true,
                  )}`,
                )}
                ${this.section(
                  translateText("troubleshooting.environment"),
                  html`
                    ${this.row(
                      translateText("troubleshooting.browser"),
                      this.diagnostics!.browser.engine,
                    )}
                    ${this.row(
                      translateText("troubleshooting.platform"),
                      this.diagnostics!.browser.platform,
                    )}
                    ${this.row(
                      translateText("troubleshooting.os"),
                      this.diagnostics!.browser.os,
                    )}
                    ${this.row(
                      translateText("troubleshooting.device_pixel_ratio"),
                      this.diagnostics!.browser.dpr,
                    )}
                    ${this.infoTip(
                      translateText("troubleshooting.chromium_tip"),
                    )}
                  `,
                )}
                ${this.section(
                  translateText("troubleshooting.rendering"),
                  html`
                    ${this.row(
                      translateText("troubleshooting.renderer"),
                      this.describeRenderer(this.diagnostics!.rendering),
                    )}
                    ${this.row(
                      translateText("troubleshooting.max_texture_size"),
                      this.diagnostics!.rendering.maxTextureSize ??
                        translateText("troubleshooting.unknown"),
                    )}
                    ${this.row(
                      translateText("troubleshooting.high_precision_shaders"),
                      this.diagnostics!.rendering.shaderHighp === true
                        ? translateText("troubleshooting.yes")
                        : translateText("troubleshooting.no"),
                    )}${this.row(
                      translateText("troubleshooting.gpu"),
                      !this.diagnostics!.rendering.gpu ||
                        this.diagnostics!.rendering.gpu.unavailable
                        ? translateText("troubleshooting.unavailable")
                        : `${this.diagnostics!.rendering.gpu.vendor} — ${this.diagnostics!.rendering.gpu.renderer}`,
                    )}
                    ${this.infoTip(translateText("troubleshooting.gpu_tip"))}
                  `,
                )}
                ${this.section(
                  translateText("troubleshooting.power"),
                  html`
                    ${this.diagnostics!.power.unavailable
                      ? this.row(
                          translateText("troubleshooting.battery"),
                          translateText("troubleshooting.unavailable"),
                        )
                      : html`
                          ${this.row(
                            translateText("troubleshooting.charging"),
                            this.diagnostics!.power.charging
                              ? translateText("troubleshooting.yes")
                              : translateText("troubleshooting.no"),
                          )}
                          ${this.row(
                            translateText("troubleshooting.battery_level"),
                            this.diagnostics!.power.level,
                          )}
                        `}
                    ${this.infoTip(
                      translateText("troubleshooting.power_saving_tip"),
                    )}
                  `,
                )}
              </div>
            `}
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        title=${translateText("troubleshooting.title")}
        ?inline=${this.inline}
        hideCloseButton
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }

  private infoTip(text: string, warning?: boolean): unknown {
    return html`
      <div
        class="mt-2 ${warning
          ? "bg-orange-500/10"
          : "bg-white/10"} flex gap-2 text-white py-1 px-3 rounded-sm  border-1 ${warning
          ? "border-orange-400"
          : "border-white/40"}"
      >
        <img src="${infoIcon}" class="w-4" />
        ${text}
      </div>
    `;
  }

  protected onOpen(): void {
    if (!this.initialized) {
      this.initialized = true;
      this.loadDiagnostics();
    }
  }

  private section(title: string, content: unknown) {
    return html`
      <div class="px-4 py-3">
        <h4
          class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400"
        >
          ${title}
        </h4>
        <div class="space-y-1">${content}</div>
      </div>
    `;
  }

  private row(label: string, value: unknown) {
    return html`
      <div class="flex justify-between gap-4 text-sm">
        <span class="text-slate-400">${label}</span>
        <span class="text-right text-white max-w-100">${value}</span>
      </div>
    `;
  }

  private async copyDiagnostics() {
    if (!this.diagnostics) return;
    const formatted =
      "```json\n" + JSON.stringify(this.diagnostics, null, 2) + "\n```";
    await navigator.clipboard.writeText(formatted);
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: html`${translateText("troubleshooting.copied_to_clipboard")}`,
          type: "info",
          duration: 3000,
        },
      }),
    );
  }

  private describeRenderer(rendering: any): string {
    if (rendering.gpu?.software) {
      return translateText("troubleshooting.software_rendering");
    }
    if (rendering.type === "Canvas2D") {
      return translateText("troubleshooting.canvas_2d_no_gpu");
    }
    return `${rendering.type}`;
  }

  public close(): void {
    this.unregisterEscapeHandler();

    if (this.inline) {
      this.style.pointerEvents = "none";
      if (window.showPage) {
        window.showPage?.("page-help");
      }
    } else {
      this.modalEl?.close();
    }
  }
}
