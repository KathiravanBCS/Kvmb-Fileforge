import { ApiProperty } from '@nestjs/swagger';

/** GET /auth/me. `id` is a BIGINT sent as a decimal string; `displayName` is nullable (core.users). */
export class AuthUserResponseDto {
  @ApiProperty({ example: '123', description: 'core.users.id (BIGINT) as a decimal string, never a number.' })
  id: string;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'core.users.display_name, may be null.' })
  displayName: string | null;

  @ApiProperty({ example: 'person@example.com' })
  email: string;
}

/** GET /auth/csrf. Send the value back in the `X-CSRF-Token` header on state-changing requests. */
export class CsrfTokenResponseDto {
  @ApiProperty({ example: 'hX3m…43 characters…Qw', description: '256-bit URL-safe token, stable for the session.' })
  csrfToken: string;
}
