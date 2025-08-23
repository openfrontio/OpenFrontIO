// This file contains shared schemas
import { z } from "zod";

export const ID = z
  .string()
  .regex(/^[a-zA-Z0-9]+$/)
  .length(8);
