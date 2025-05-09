import quickChatData from "../../../resources/QuickChat.json";
import { consolex } from "../Consolex";
import { Execution, Game, MessageType, Player, PlayerID } from "../game/Game";

export class QuickChatExecution implements Execution {
  private sender: Player;
  private recipient: Player;
  private mg: Game;

  private active = true;

  constructor(
    private senderID: PlayerID,
    private recipientID: PlayerID,
    private quickChatKey: string,
    private variables: Record<string, string>,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (!mg.hasPlayer(this.senderID)) {
      consolex.warn(`QuickChatExecution: sender ${this.senderID} not found`);
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.recipientID)) {
      consolex.warn(
        `QuickChatExecution: recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.sender = mg.player(this.senderID);
    this.recipient = mg.player(this.recipientID);
  }

  tick(ticks: number): void {
    const message = this.getMessageFromKey(this.quickChatKey, this.variables);

    this.mg.displayMessage(
      `${this.sender.name()}: ${message}`,
      MessageType.CHAT,
      this.recipient.id(),
    );

    this.mg.displayMessage(
      `You sent to ${this.recipient.name()}: ${message}`,
      MessageType.CHAT,
      this.sender.id(),
    );

    consolex.log(
      `[QuickChat] ${this.sender.name} → ${this.recipient.name}: ${message}`,
    );

    this.active = false;
  }

  owner(): Player {
    return this.sender;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private getMessageFromKey(
    fullKey: string,
    vars: Record<string, string>,
  ): string {
    // Key for translation
    const [category, key] = fullKey.split(".");
    const phrases = quickChatData[category];

    if (!phrases) {
      consolex.warn(`QuickChat: Unknown category '${category}'`);
      return `[${fullKey}]`;
    }

    const phraseObj = phrases.find((p) => p.key === key);
    if (!phraseObj) {
      consolex.warn(
        `QuickChat: Key '${key}' not found in category '${category}'`,
      );
      return `[${fullKey}]`;
    }

    return phraseObj.text.replace(
      /\[(\w+)\]/g,
      (_, p1) => vars[p1] || `[${p1}]`,
    );
  }
}
