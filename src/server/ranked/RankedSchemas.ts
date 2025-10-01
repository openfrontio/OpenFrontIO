import { z } from "zod";
import { RankedMode, RankedRegion } from "./types";

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const RankedQueueJoinRequestSchema = z.object({
  playerId: IdentifierSchema,
  mode: z.nativeEnum(RankedMode).default(RankedMode.Duel),
  region: z.nativeEnum(RankedRegion).default(RankedRegion.Global),
  mmr: z.number().min(0).max(5000).optional(),
  username: z.string().max(100).optional(),
});

export const RankedTicketIdSchema = IdentifierSchema;

export const RankedMatchIdSchema = IdentifierSchema;

export const RankedMatchAcceptSchema = z.object({
  ticketId: IdentifierSchema,
  playerId: IdentifierSchema,
  acceptToken: IdentifierSchema,
});

export const RankedMatchDeclineSchema = z.object({
  ticketId: IdentifierSchema,
  playerId: IdentifierSchema,
});

export type RankedQueueJoinRequestInput = z.infer<
  typeof RankedQueueJoinRequestSchema
>;
