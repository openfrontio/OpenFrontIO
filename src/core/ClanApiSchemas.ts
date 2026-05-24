import { z } from "zod";
import { ClanTagSchema } from "./Schemas";

const RequiredClanTagSchema = ClanTagSchema.unwrap();

export const ClanLeaderboardEntrySchema = z.object({
  clanTag: RequiredClanTagSchema,
  games: z.number(),
  wins: z.number(),
  losses: z.number(),
  playerSessions: z.number(),
  weightedWins: z.number(),
  weightedLosses: z.number(),
  weightedWLRatio: z.number(),
});
export type ClanLeaderboardEntry = z.infer<typeof ClanLeaderboardEntrySchema>;

export const ClanLeaderboardResponseSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  clans: ClanLeaderboardEntrySchema.array(),
  total: z.number().optional(),
  limit: z.number().optional(),
});
export type ClanLeaderboardResponse = z.infer<
  typeof ClanLeaderboardResponseSchema
>;

export const ClanInfoSchema = z.object({
  name: z.string().max(35),
  tag: RequiredClanTagSchema,
  description: z.string().max(200),
  isOpen: z.boolean(),
  createdAt: z.iso.datetime().optional(),
  memberCount: z.number().optional(),
});
export type ClanInfo = z.infer<typeof ClanInfoSchema>;

export const ClanBrowseResponseSchema = z.object({
  results: ClanInfoSchema.array(),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type ClanBrowseResponse = z.infer<typeof ClanBrowseResponseSchema>;

export const ClanMemberWLSchema = z.object({
  wins: z.number(),
  losses: z.number(),
});
export type ClanMemberWL = z.infer<typeof ClanMemberWLSchema>;

export const ClanMemberStatsSchema = z.object({
  total: ClanMemberWLSchema,
  ffa: ClanMemberWLSchema,
  team: ClanMemberWLSchema,
  hvn: ClanMemberWLSchema,
  duos: ClanMemberWLSchema,
  trios: ClanMemberWLSchema,
  quads: ClanMemberWLSchema,
  "2": ClanMemberWLSchema,
  "3": ClanMemberWLSchema,
  "4": ClanMemberWLSchema,
  "5": ClanMemberWLSchema,
  "6": ClanMemberWLSchema,
  "7": ClanMemberWLSchema,
  ranked: ClanMemberWLSchema,
  "1v1": ClanMemberWLSchema,
});
export type ClanMemberStats = z.infer<typeof ClanMemberStatsSchema>;

export const TEAM_BREAKDOWN_KEYS = [
  "duos",
  "trios",
  "quads",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
] as const satisfies readonly (keyof ClanMemberStats)[];

export const RANKED_BREAKDOWN_KEYS = [
  "1v1",
] as const satisfies readonly (keyof ClanMemberStats)[];

export const ClanMemberSchema = z.object({
  role: z.enum(["leader", "officer", "member"]),
  joinedAt: z.iso.datetime(),
  publicId: z.string(),
  stats: ClanMemberStatsSchema.optional(),
});
export type ClanMember = z.infer<typeof ClanMemberSchema>;

export const ClanMembersResponseSchema = z.object({
  results: ClanMemberSchema.array(),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  pendingRequests: z.number().optional(),
});
export type ClanMembersResponse = z.infer<typeof ClanMembersResponseSchema>;

export const ClanJoinRequestSchema = z.object({
  publicId: z.string(),
  createdAt: z.iso.datetime(),
});
export type ClanJoinRequest = z.infer<typeof ClanJoinRequestSchema>;

export const ClanRequestsResponseSchema = z.object({
  results: ClanJoinRequestSchema.array(),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type ClanRequestsResponse = z.infer<typeof ClanRequestsResponseSchema>;

export const ClanBanSchema = z.object({
  publicId: z.string(),
  bannedBy: z.string(),
  reason: z.string().max(200).nullable(),
  createdAt: z.iso.datetime(),
});
export type ClanBan = z.infer<typeof ClanBanSchema>;

export const ClanBansResponseSchema = z.object({
  results: ClanBanSchema.array(),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type ClanBansResponse = z.infer<typeof ClanBansResponseSchema>;

export const JoinClanResponseSchema = z.object({
  status: z.enum(["joined", "requested"]),
});
export type JoinClanResponse = z.infer<typeof JoinClanResponseSchema>;

export const ClanStatsSchema = z.object({
  clanTag: RequiredClanTagSchema,
  games: z.number(),
  wins: z.number(),
  losses: z.number(),
  stats: ClanMemberStatsSchema,
  teamTypeWL: z.record(
    z.string(),
    z.object({ wl: z.tuple([z.number(), z.number()]) }),
  ),
  teamCountWL: z.record(
    z.string(),
    z.object({ wl: z.tuple([z.number(), z.number()]) }),
  ),
});
export type ClanStats = z.infer<typeof ClanStatsSchema>;
