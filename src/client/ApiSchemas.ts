import { z } from "zod";
import { base64urlToUuid } from "./Base64";

export const TokenPayloadSchema = z.object({
  jti: z.string(),
  sub: z
    .string()
    .refine(
      (val) => {
        const uuid = base64urlToUuid(val);
        return uuid != null;
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
    .transform((val) => val.split(",")),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const UserMeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    avatar: z.string(),
    username: z.string(),
    global_name: z.string(),
    discriminator: z.string(),
    locale: z.string(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;
