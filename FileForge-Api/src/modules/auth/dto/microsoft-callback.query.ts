import { z } from 'zod';

/**
 * Query string of the redirect back from Microsoft. Strict on shape and size; unknown parameters
 * (session_state, client_info, ...) are dropped, and repeated parameters (arrays) are rejected.
 */
export const microsoftCallbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  // Our own state values are 43-character base64url strings.
  state: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,128}$/)
    .optional(),
  error: z.string().max(100).optional(),
  // Accepted but deliberately never read, logged or forwarded: it is attacker-influenced free text.
  error_description: z.string().max(2000).optional(),
});

export type MicrosoftCallbackQuery = z.infer<typeof microsoftCallbackQuerySchema>;
