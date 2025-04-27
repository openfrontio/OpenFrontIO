import { z } from "zod";

export const UserMeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    avatar: z.string(),
  }),
});
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;
