import { z } from "zod/v4";
import { base64urlToUuid } from "./Base64";

export const RefreshResponseSchema = z.object({
  token: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const TokenPayloadSchema = z.object({
  jti: z.string(),
  sub: z
    .string()
    .refine(
      (val) => {
        const uuid = base64urlToUuid(val);
        return !!uuid;
      },
      {
        message: "Invalid base64-encoded UUID",
      },
    )
    .transform((val) => {
      const uuid = base64urlToUuid(val);
      if (!uuid) throw new Error("Invalid base64 UUID");
      return uuid;
    }),
  iat: z.number(),
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const UserMeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    avatar: z.string().nullable(),
    username: z.string(),
    global_name: z.string().nullable(),
    discriminator: z.string(),
    locale: z.string().optional(),
  }),
  player: z.object({
    publicId: z.string(),
    roles: z.string().array().optional(),
    flares: z.string().array().optional(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;

export const discordIdHashes = [
  1661393335, 1851863381, 1003936817, 653544870, 1557759837, 1042722497,
  65439800, 155156957, 1218512162, 426095068, 416547875, 1798289200, 1052294911,
  1083112658, 1233079359, 774244699, 952418618, 1215601556, 1716860484,
  1853687192, 247930283, 247930283, 2132635226, 1869027023, 2001674915,
  766449506, 153828422, 145274786, 2046238715, 253694988, 1507817897,
  1646270753, 542766539, 351814673, 365160220, 828883677, 2033416503, 37123544,
  961728307, 94814174, 1304192493, 1414342672, 2137156610, 1894770459,
  103555344, 174993017, 1205888044, 1252537152, 1469901896, 1457907846,
  388895429, 1201515958, 1460910617, 504159584, 1988458085, 938609279,
  151073647, 1638157021, 608899192, 699791521, 940653944, 191262706, 1433232464,
  949130070, 985289297, 160421750, 423901399, 2053086809, 813603540, 262358277,
  240859002, 1788524537, 717454965, 1896548568, 1624081483, 135101486,
  1673600636, 523037306, 1713725183, 602978453, 951411520, 644853372,
  2031630654, 199624311, 1740705355,
];
