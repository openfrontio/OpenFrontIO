import { z } from "zod";

export const TokenPayloadSchema = z
  .object({
    sub: z.string().uuid(),
    state: z.string(),
    iat: z.number(),
    iss: z.string(),
    aud: z.string(),
    exp: z.number(),
  })
  .strict();
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
