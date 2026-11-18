import { z } from "zod";

/** Default time-to-live (in milliseconds) for a lobby invite. */
export const LOBBY_INVITE_TTL_MS = 30_000;

export const MAX_PUBLIC_ID_LENGTH = 64;
export const MAX_LOBBY_ID_LENGTH = 64;
export const MAX_USERNAME_LENGTH = 100;
export const MAX_GAME_MODE_LENGTH = 100;
export const MAX_MAP_NAME_LENGTH = 100;

/** Schema for a lobby invite delivered to a player. */
export const LobbyInviteSchema = z.object({
  id: z.string(),
  lobbyId: z.string().max(MAX_LOBBY_ID_LENGTH),
  senderPublicId: z.string().max(MAX_PUBLIC_ID_LENGTH),
  senderUsername: z.string().max(MAX_USERNAME_LENGTH).nullable().optional(),
  targetPublicId: z.string().max(MAX_PUBLIC_ID_LENGTH),
  gameMode: z.string().max(MAX_GAME_MODE_LENGTH).optional(),
  map: z.string().max(MAX_MAP_NAME_LENGTH).optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
export type LobbyInvite = z.infer<typeof LobbyInviteSchema>;

/**
 * Input payload for `POST /api/lobby/invite`.
 * `senderPublicId` and `senderUsername` are derived server-side from the
 * authenticated caller session when handled via HTTP routes.
 */
export const SendLobbyInviteInputSchema = z.object({
  targetPublicId: z.string().min(1).max(MAX_PUBLIC_ID_LENGTH),
  lobbyId: z.string().min(1).max(MAX_LOBBY_ID_LENGTH),
  senderPublicId: z.string().min(1).max(MAX_PUBLIC_ID_LENGTH).optional(),
  senderUsername: z.string().max(MAX_USERNAME_LENGTH).nullable().optional(),
  gameMode: z.string().max(MAX_GAME_MODE_LENGTH).optional(),
  map: z.string().max(MAX_MAP_NAME_LENGTH).optional(),
});
export type SendLobbyInviteInput = z.infer<typeof SendLobbyInviteInputSchema>;

/**
 * Input payload for `POST /api/lobby/invites/dismiss`.
 * Ownership (`publicId`) is resolved server-side from the authenticated session.
 */
export const DismissLobbyInviteInputSchema = z.object({
  inviteId: z.string().min(1),
  publicId: z.string().min(1).optional(),
});
export type DismissLobbyInviteInput = z.infer<
  typeof DismissLobbyInviteInputSchema
>;

/** Response payload for `GET /api/lobby/invites`. */
export const LobbyInvitesResponseSchema = z.object({
  invites: z.array(LobbyInviteSchema),
  serverTime: z.number(),
});
export type LobbyInvitesResponse = z.infer<typeof LobbyInvitesResponseSchema>;
