import type { Request, Response } from 'express';

import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { SESSION_SECURITY_SCHEME } from '../../../app.swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthFlowError } from '../../../common/exceptions/auth-flow.error';
import type { SessionUser } from '../../../common/types/session.types';
import { describeError } from '../../../common/utils/logging.util';
import appConfig from '../../../config/app.config';
import { AuthUserResponseDto, CsrfTokenResponseDto } from '../dto/auth-responses.dto';
import { MicrosoftLoginService } from '../services/microsoft-login.service';
import { SessionService } from '../services/session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly login: MicrosoftLoginService,
    private readonly sessions: SessionService,
    @Inject(appConfig.KEY) private readonly config: ConfigType<typeof appConfig>,
  ) {}

  /** Starts Microsoft sign-in: redirects the browser to Microsoft. No tokens are involved yet. */
  @ApiOperation({
    summary: 'Start Microsoft sign-in',
    description: 'Browser navigation, not an XHR call. Redirects to Microsoft; no tokens are returned.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to Microsoft, or to the frontend with ?auth_error=service_unavailable.',
  })
  @Public()
  @Get('microsoft/login')
  async startLogin(@Req() request: Request, @Res() response: Response): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response.redirect(await this.login.start(request));
    } catch (error) {
      this.redirectWithFailure(
        response,
        new AuthFlowError('service_unavailable', 'login_start_failed', { cause: error }),
      );
    }
  }

  /** Microsoft redirects here. Always ends in a redirect to the frontend: `/` on success, `/?auth_error=<code>` otherwise. */
  @ApiOperation({
    summary: 'Microsoft sign-in callback',
    description:
      'Called by Microsoft, not by the app. Validates state, nonce and PKCE, exchanges the code, provisions the user and ' +
      'starts the session. Always answers with a redirect to the frontend.',
  })
  @ApiResponse({
    status: 302,
    description:
      'Sign-in: frontend `/` on success, `/?auth_error=<code>` on failure. Connect OneDrive: `/files?onedrive=connected` on ' +
      'success, `/files?onedrive_error=<code>` on failure. Connect central storage (administrators): `/admin/storage/settings?central=connected` ' +
      'on success, `/admin/storage/settings?central_error=<code>` on failure. Codes: access_denied, consent_required, session_expired, login_failed, ' +
      'account_unavailable, service_unavailable, account_mismatch, workspace_forbidden, onedrive_unavailable.',
  })
  @Public()
  @Get('microsoft/callback')
  async callback(@Req() request: Request, @Res() response: Response, @Query() query: unknown): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const { redirectPath } = await this.login.complete(request, query);
      response.redirect(`${this.config.frontendOrigin}${redirectPath}`);
    } catch (error) {
      const failure =
        error instanceof AuthFlowError ? error : new AuthFlowError('login_failed', 'unexpected', { cause: error });
      this.redirectWithFailure(response, failure);
    }
  }

  @ApiOperation({ summary: 'The signed-in user' })
  @ApiCookieAuth(SESSION_SECURITY_SCHEME)
  @ApiResponse({ status: 200, type: AuthUserResponseDto })
  @ApiResponse({ status: 401, description: 'Not signed in: `{ error: { code: "UNAUTHENTICATED", … } }`.' })
  @Get('me')
  me(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) response: Response): AuthUserResponseDto {
    response.setHeader('Cache-Control', 'no-store');
    return { id: user.id, displayName: user.displayName, email: user.email };
  }

  /** The CSRF token for this session. Send it as `X-CSRF-Token` on POST/PUT/PATCH/DELETE. */
  @ApiOperation({ summary: 'CSRF token for this session' })
  @ApiCookieAuth(SESSION_SECURITY_SCHEME)
  @ApiResponse({ status: 200, type: CsrfTokenResponseDto })
  @ApiResponse({ status: 401, description: 'Not signed in.' })
  @Get('csrf')
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response): CsrfTokenResponseDto {
    response.setHeader('Cache-Control', 'no-store');
    const csrfToken = request.session.csrfToken;
    if (!csrfToken) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Authentication required.' });
    return { csrfToken };
  }

  /** Needs a signed-in session (global guard) and a valid CSRF token (global guard). */
  @ApiOperation({
    summary: 'Sign out',
    description:
      'Destroys the server-side session and clears the cookie. Not usable from Swagger UI: its origin is not the ' +
      'frontend origin, so the CSRF origin check answers 403 CSRF_ORIGIN_MISMATCH. Use the React app.',
  })
  @ApiCookieAuth(SESSION_SECURITY_SCHEME)
  @ApiHeader({ name: 'X-CSRF-Token', required: true, description: 'Value of GET /auth/csrf.' })
  @ApiResponse({ status: 204, description: 'Signed out; session cookie cleared.' })
  @ApiResponse({ status: 401, description: 'Not signed in.' })
  @ApiResponse({ status: 403, description: 'CSRF_TOKEN_INVALID or CSRF_ORIGIN_MISMATCH.' })
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.sessions.destroy(request, response);
    this.logger.log({ event: 'auth_logout' });
  }

  private redirectWithFailure(response: Response, failure: AuthFlowError): void {
    // Only internal slugs and error class names are logged: never tokens, codes, state or messages.
    this.logger.warn({
      event:
        failure.purpose === 'connect_onedrive'
          ? 'onedrive_connect_failed'
          : failure.purpose === 'connect_central_storage'
            ? 'central_storage_connect_failed'
            : 'auth_login_failed',
      code: failure.code,
      reason: failure.reason,
      cause: failure.cause ? describeError(failure.cause) : undefined,
    });
    // Where to land is decided here from the flow that failed, never from anything the browser sent.
    const target =
      failure.purpose === 'connect_onedrive'
        ? `/files?onedrive_error=${failure.code}`
        : failure.purpose === 'connect_central_storage'
          ? `/admin/storage/settings?central_error=${failure.code}`
          : `/?auth_error=${failure.code}`;
    response.redirect(`${this.config.frontendOrigin}${target}`);
  }
}
