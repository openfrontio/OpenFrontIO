import { z } from "zod";
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
  rol: z
    .string()
    .optional()
    .transform((val) => (val ?? "").split(",")),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

// https://discord.com/developers/docs/reference#snowflakes
const DiscordSnowflakeSchema = z
  .string()
  .regex(/^\d+$/, { message: "Snowflake must be digits only" })
  .refine(
    (val) => {
      try {
        const bigVal = BigInt(val);
        return bigVal >= 0n && bigVal <= 18446744073709551615n;
      } catch {
        return false;
      }
    },
    {
      message: "Snowflake must be a valid 64-bit unsigned integer",
    },
  );
export type DiscordSnowflake = z.infer<typeof DiscordSnowflakeSchema>;

// https://discord.com/developers/docs/resources/user#avatar-decoration-data-object
export const DiscordAvatarDecorationSchema = z.object({
  asset: z.string(), // the avatar decoration hash
  sku_id: DiscordSnowflakeSchema, // id of the avatar decoration's SKU
});

// https://discord.com/developers/docs/resources/user#user-object
export const DiscordUserSchema = z.object({
  id: DiscordSnowflakeSchema,
  username: z.string(),
  discriminator: z.string(),
  global_name: z.string().nullable(),
  avatar: z.string().nullable(),
  locale: z.string().optional(),
});
export type DiscordUser = z.infer<typeof DiscordUserSchema>;

export const UserMeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    avatar: z.string(),
    username: z.string(),
    global_name: z.string(),
    discriminator: z.string(),
    locale: z.string(),
  }),
  player: z.object({
    publicId: z.string(),
    flares: z.string().array(),
    roles: z.string().array(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;
