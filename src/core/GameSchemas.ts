import { z } from "zod";
import { Difficulty } from "./game/Game";

export const DifficultySchema = z.enum(Difficulty);
