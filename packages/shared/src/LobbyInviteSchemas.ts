import { z } from "zod";

export const LOBBY_INVITE_TTL_MS = 30_000;

export const LobbyInviteSchema = z.object({
  id: z.string(),
  lobbyId: z.string(),
  senderPublicId: z.string(),
  senderUsername: z.string().nullable().optional(),
  targetPublicId: z.string(),
  gameMode: z.string().optional(),
  map: z.string().optional(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
export type LobbyInvite = z.infer<typeof LobbyInviteSchema>;

export const SendLobbyInviteInputSchema = z.object({
  targetPublicId: z.string().min(1),
  lobbyId: z.string().min(1),
  senderPublicId: z.string().min(1),
  senderUsername: z.string().nullable().optional(),
  gameMode: z.string().optional(),
  map: z.string().optional(),
});
export type SendLobbyInviteInput = z.infer<typeof SendLobbyInviteInputSchema>;

export const DismissLobbyInviteInputSchema = z.object({
  inviteId: z.string().min(1),
  publicId: z.string().min(1),
});
export type DismissLobbyInviteInput = z.infer<
  typeof DismissLobbyInviteInputSchema
>;
