import { z } from 'zod';

// GET /workspaces: the workspaces the signed-in user belongs to, with their role in each.
export const workspaceSchema = z.object({
  id: z.string().regex(/^\d+$/), // BIGINT as a decimal string
  name: z.string(),
  type: z.string(),
  role: z.string(),
});

export type Workspace = z.infer<typeof workspaceSchema>;
