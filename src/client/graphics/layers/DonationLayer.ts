import { Cell, MessageType } from "../../../core/game/Game";
import {
  DisplayMessageUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { renderNumber, renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import donateGoldIcon from "/images/DonateGoldIconWhite.svg?url";
import donateTroopIcon from "/images/DonateTroopIconWhite.svg?url";

type DonationKind = "troops" | "gold";

type DonationEdge = {
  senderSmallID: number;
  recipientSmallID: number;
  lastDonationTick: number;
  lastDonationRatio: number; // 0..1
  lastKind: DonationKind;
  lastAmountLabel: string;
  totalTroopsSent: number;
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export class DonationLayer implements Layer {
  private edges = new Map<string, DonationEdge>();
  private troopIconImage: HTMLImageElement | null = null;
  private goldIconImage: HTMLImageElement | null = null;

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
  ) {}

  shouldTransform(): boolean {
    return false;
  }

  init() {
    this.troopIconImage = new Image();
    this.troopIconImage.src = donateTroopIcon;

    this.goldIconImage = new Image();
    this.goldIconImage.src = donateGoldIcon;
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    const tick = this.game.ticks();
    for (const update of updates[GameUpdateType.DisplayEvent]) {
      this.onDisplayMessage(update, tick);
    }
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const fadeTicks = Math.max(1, this.game.config().donateCooldown());
    const nowTick = this.game.ticks();

    const drawable: DonationEdge[] = [];
    for (const [key, edge] of this.edges.entries()) {
      const age = nowTick - edge.lastDonationTick;
      if (age >= fadeTicks) {
        this.edges.delete(key);
        continue;
      }
      drawable.push(edge);
    }

    if (drawable.length === 0) return;

    const byPair = new Map<string, DonationEdge[]>();
    for (const edge of drawable) {
      const a = Math.min(edge.senderSmallID, edge.recipientSmallID);
      const b = Math.max(edge.senderSmallID, edge.recipientSmallID);
      const pairKey = `${a}-${b}`;
      const list = byPair.get(pairKey) ?? [];
      list.push(edge);
      byPair.set(pairKey, list);
    }

    for (const [pairKey, edges] of byPair) {
      if (edges.length === 1) {
        this.drawEdge(context, edges[0], 0);
        continue;
      }

      // Two arrows between the same players: offset them on opposite sides.
      // If more somehow exist, just render them without offset after the first two.
      const [minStr] = pairKey.split("-");
      const minId = Number(minStr);
      const offsetPx = 7;

      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const sign = edge.senderSmallID === minId ? 1 : -1;
        const signedOffset = i < 2 ? sign * offsetPx : 0;
        this.drawEdge(context, edge, signedOffset);
      }
    }
  }

  private onDisplayMessage(event: DisplayMessageUpdate, tick: number) {
    const isDonation =
      event.messageType === MessageType.SENT_TROOPS_TO_PLAYER ||
      event.messageType === MessageType.RECEIVED_TROOPS_FROM_PLAYER ||
      event.messageType === MessageType.SENT_GOLD_TO_PLAYER ||
      event.messageType === MessageType.RECEIVED_GOLD_FROM_PLAYER;
    if (!isDonation) return;

    const params = event.params;
    if (!params) return;

    const senderSmallID = Number(params.donationSenderSmallID);
    const recipientSmallID = Number(params.donationRecipientSmallID);
    if (!Number.isFinite(senderSmallID) || !Number.isFinite(recipientSmallID)) {
      return;
    }
    if (senderSmallID <= 0 || recipientSmallID <= 0) return;

    const kind = params.donationKind === "gold" ? "gold" : "troops";
    const ratio = clamp01(Number(params.donationRatio ?? 0));

    let amountLabel = "";
    if (kind === "troops") {
      const troopsLabel = params.troops;
      const troopsAmount = Number(params.donationTroopsAmount ?? 0);
      amountLabel =
        typeof troopsLabel === "string"
          ? troopsLabel
          : renderTroops(troopsAmount);
    } else {
      const goldLabel = params.gold;
      const goldAmount = event.goldAmount ?? 0n;
      amountLabel =
        typeof goldLabel === "string" ? goldLabel : renderNumber(goldAmount);
    }

    const key = this.key(senderSmallID, recipientSmallID);
    const prev = this.edges.get(key);
    const totalTroopsSent =
      kind === "troops"
        ? (prev?.totalTroopsSent ?? 0) +
          Number(params.donationTroopsAmount ?? 0)
        : (prev?.totalTroopsSent ?? 0);

    this.edges.set(key, {
      senderSmallID,
      recipientSmallID,
      lastDonationTick: tick,
      lastDonationRatio: ratio,
      lastKind: kind,
      lastAmountLabel: amountLabel,
      totalTroopsSent,
    });
  }

  private drawEdge(
    ctx: CanvasRenderingContext2D,
    edge: DonationEdge,
    perpendicularOffsetPx: number,
  ) {
    const fadeTicks = Math.max(1, this.game.config().donateCooldown());
    const ageTicks = this.game.ticks() - edge.lastDonationTick;
    const alpha = 1 - ageTicks / fadeTicks;
    if (alpha <= 0) return;

    let sender: PlayerView;
    let recipient: PlayerView;
    try {
      // Keep this in a try/catch: playerBySmallID can throw during early ticks.
      const senderAny = this.game.playerBySmallID(edge.senderSmallID);
      const recipientAny = this.game.playerBySmallID(edge.recipientSmallID);
      if (
        !(senderAny instanceof PlayerView) ||
        !(recipientAny instanceof PlayerView)
      ) {
        return;
      }
      sender = senderAny;
      recipient = recipientAny;
    } catch {
      return;
    }
    const senderLoc = sender.nameLocation();
    const recipientLoc = recipient.nameLocation();
    if (!senderLoc || !recipientLoc) return;

    const senderPos = this.worldToCanvas(senderLoc.x, senderLoc.y);
    const recipientPos = this.worldToCanvas(recipientLoc.x, recipientLoc.y);
    if (!senderPos || !recipientPos) return;

    const dx0 = recipientPos.x - senderPos.x;
    const dy0 = recipientPos.y - senderPos.y;
    const dist0 = Math.hypot(dx0, dy0);
    if (!Number.isFinite(dist0) || dist0 < 30) return;

    const invDist0 = 1 / dist0;
    const dir = { x: dx0 * invDist0, y: dy0 * invDist0 };
    const perp = { x: -dir.y, y: dir.x };

    const from = {
      x: senderPos.x + perp.x * perpendicularOffsetPx,
      y: senderPos.y + perp.y * perpendicularOffsetPx,
    };
    const to = {
      x: recipientPos.x + perp.x * perpendicularOffsetPx,
      y: recipientPos.y + perp.y * perpendicularOffsetPx,
    };

    const ratio = clamp01(edge.lastDonationRatio);
    const width = Math.max(0, Math.min(10, ratio * 10));
    if (width <= 0.1) return;

    const stroke = sender.territoryColor().toHex();

    const tipInset = 18;
    const startInset = 14;
    const headLen = Math.max(10, 8 + width * 1.4);
    const headWidth = Math.max(10, 8 + width * 1.8);

    const tip = { x: to.x - dir.x * tipInset, y: to.y - dir.y * tipInset };
    const lineStart = {
      x: from.x + dir.x * startInset,
      y: from.y + dir.y * startInset,
    };
    const base = { x: tip.x - dir.x * headLen, y: tip.y - dir.y * headLen };

    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alpha;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(lineStart.x, lineStart.y);
    ctx.lineTo(base.x, base.y);
    ctx.stroke();

    const left = {
      x: base.x + perp.x * (headWidth / 2),
      y: base.y + perp.y * (headWidth / 2),
    };
    const right = {
      x: base.x - perp.x * (headWidth / 2),
      y: base.y - perp.y * (headWidth / 2),
    };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();

    this.drawDonationBadge(ctx, edge, {
      x: (lineStart.x + base.x) / 2,
      y: (lineStart.y + base.y) / 2,
    });

    ctx.restore();
  }

  private drawDonationBadge(
    ctx: CanvasRenderingContext2D,
    edge: DonationEdge,
    pos: { x: number; y: number },
  ) {
    const iconSize = 14;
    const paddingX = 6;
    const paddingY = 4;
    const gap = 5;
    const fontSize = 12;

    const fontFamily = this.game.config().theme().font();
    ctx.font = `600 ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "middle";

    const text = edge.lastAmountLabel;
    const textWidth = Math.ceil(ctx.measureText(text).width);
    const height = iconSize + paddingY * 2;
    const width = paddingX * 2 + iconSize + gap + textWidth;

    const x = pos.x - width / 2;
    const y = pos.y - height / 2;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;

    this.roundedRect(ctx, x, y, width, height, height / 2);
    ctx.fill();
    ctx.stroke();

    const icon =
      edge.lastKind === "gold" ? this.goldIconImage : this.troopIconImage;
    if (icon && icon.complete && icon.naturalWidth > 0) {
      ctx.drawImage(icon, x + paddingX, y + paddingY, iconSize, iconSize);
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fillText(text, x + paddingX + iconSize + gap, y + height / 2);

    ctx.restore();
  }

  private roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  private worldToCanvas(x: number, y: number): { x: number; y: number } | null {
    const rect = this.transformHandler.boundingRect();
    if (!rect) return null;
    const screen = this.transformHandler.worldToScreenCoordinates(
      new Cell(x, y),
    );
    return { x: screen.x - rect.left, y: screen.y - rect.top };
  }

  private key(senderSmallID: number, recipientSmallID: number): string {
    return `${senderSmallID}->${recipientSmallID}`;
  }
}
