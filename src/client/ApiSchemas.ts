import { z } from "zod";

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
