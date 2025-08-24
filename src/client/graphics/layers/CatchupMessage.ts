import { translateText } from "../../Utils";

export class CatchupMessage {
  private readonly element: HTMLDivElement = document.createElement("div");

  constructor() {
    this.element.id = "catchup-message";
    this.element.style.position = "fixed";
    this.element.style.top = "50%";
    this.element.style.left = "50%";
    this.element.style.transform = "translate(-50%, -50%)";
    this.element.style.backgroundColor = "rgba(255, 200, 0, 0.7)";
    this.element.style.padding = "10px 20px";
    this.element.style.borderRadius = "5px";
    this.element.style.zIndex = "1000";
    this.element.style.display = "none";
    document.body.appendChild(this.element);
  }

  show(progress: number): void {
    const p = Math.min(Math.max(progress, 0), 100);
    this.element.textContent = `${translateText("catchup_overlay.catchup_notice", { progress: p })}`;
    this.element.style.display = "block";
  }

  hide(): void {
    this.element.style.display = "none";
  }
}
