export const CloseCode = {
  Normal: 1000,
  ProtocolError: 1002,
  InternalError: 1011,
  TryAgainLater: 1013,
  BadRequest: 4000,
  Unauthorized: 4001,
  Forbidden: 4002,
  Banned: 4003,
  GameNotFound: 4004,
  GameClosed: 4005,
  LobbyFull: 4006,
  RankedLimitReached: 4100,
  InvalidClan: 4101,
  ClanVerificationFailed: 4102,
} as const;

export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

export const APP_REJECTION_MIN = 4000;
export const APP_REJECTION_MAX = 4999;

export function isTerminalClose(code: number): boolean {
  return (
    code === CloseCode.Normal ||
    code === CloseCode.ProtocolError ||
    (code >= APP_REJECTION_MIN && code <= APP_REJECTION_MAX)
  );
}

export const CloseReason = {
  InvalidMessage: "close_reason.invalid_message",
  InvalidToken: "close_reason.invalid_token",
  Banned: "close_reason.banned",
  TurnstileFailed: "close_reason.turnstile_failed",
  LoginRequired: "close_reason.login_required",
  AccountLookupFailed: "close_reason.account_lookup_failed",
  Forbidden: "close_reason.forbidden",
  CosmeticsForbidden: "close_reason.cosmetics_forbidden",
  GameNotFound: "close_reason.game_not_found",
  CannotJoin: "close_reason.cannot_join",
  NotAllowlisted: "close_reason.not_allowlisted",
  NotTrusted: "close_reason.not_trusted",
  LobbyFull: "close_reason.lobby_full",
  InternalError: "close_reason.internal_error",
  ProtocolError: "close_reason.protocol_error",
  NoHeartbeat: "close_reason.no_heartbeat",
  GameEnded: "close_reason.game_ended",
  RankedLimitReached: "close_reason.ranked_limit_reached",
  InvalidClan: "close_reason.invalid_clan",
  ClanVerificationFailed: "close_reason.clan_verification_failed",
} as const;

export type CloseReason = (typeof CloseReason)[keyof typeof CloseReason];
