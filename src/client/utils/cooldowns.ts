import { AllPlayers, PlayerType } from "../../core/game/Game";
import { GameView, PlayerView } from "../../core/game/GameView";

export function isEmojiCoolingDown(
  g: GameView,
  my: PlayerView,
  recipient: PlayerView | typeof AllPlayers,
  canSendEmoji?: boolean,
): boolean {
  if (canSendEmoji) return false;
  const msgs = my.outgoingEmojis();
  const recipientID =
    recipient === AllPlayers ? AllPlayers : recipient.smallID();
  let last = -1;
  for (const m of msgs) {
    if (m.recipientID === recipientID && m.createdAt > last) last = m.createdAt;
  }
  if (last < 0) return false;
  const elapsed = g.ticks() - last;
  return elapsed < g.config().emojiMessageCooldown();
}

export function isTargetCoolingDown(
  my: PlayerView,
  other: PlayerView,
  canTarget?: boolean,
): boolean {
  if (canTarget) return false;
  return other !== my && !my.isFriendly(other);
}

export function isDonationCoolingDown(
  g: GameView,
  my: PlayerView,
  other: PlayerView,
  kind: "gold" | "troops",
  canDonate?: boolean,
): boolean {
  if (canDonate) return false;
  const bothAlive = my.isAlive() && other.isAlive();
  const friendly = my.isFriendly(other);
  const configAllows =
    kind === "gold"
      ? other.type() !== PlayerType.Human || g.config().donateGold()
      : other.type() !== PlayerType.Human || g.config().donateTroops();
  return bothAlive && friendly && configAllows;
}

export function isAllianceCoolingDown(
  my: PlayerView,
  other: PlayerView,
  canSend?: boolean,
): boolean {
  if (canSend) return false;
  if (other === my) return false;
  const notFriendly = !my.isFriendly(other);
  const bothConnected = !my.isDisconnected() && !other.isDisconnected();
  const hasPending = my.isRequestingAllianceWith(other);
  return notFriendly && bothConnected && !hasPending;
}

export function isEmbargoAllCoolingDown(
  g: GameView,
  my: PlayerView,
  canEmbargoAll?: boolean,
): boolean {
  if (canEmbargoAll) return false;
  const eligibleExists = g
    .players()
    .some(
      (p) => p !== my && p.type() !== PlayerType.Bot && !my.isOnSameTeam(p),
    );
  return eligibleExists;
}
