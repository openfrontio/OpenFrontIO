import { z } from "zod";

export const TokenPayloadSchema = z.object({
  jti: z.string(),
  sub: z.string().uuid(),
  iat: z.number(),
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
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
