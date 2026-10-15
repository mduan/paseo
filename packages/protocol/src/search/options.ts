import { z } from "zod";

export const SearchOptionsSchema = z.object({
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  regex: z.boolean().optional(),
});
export type SearchOptions = z.infer<typeof SearchOptionsSchema>;
