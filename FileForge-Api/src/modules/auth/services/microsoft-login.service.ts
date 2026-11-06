import type { Request } from 'express';

import { Injectable, Logger } from '@nestjs/common';

import { AuthFlowError } from '../../../common/exceptions/auth-flow.error';
import type { OAuthPurpose, OAuthTransaction } from '../../../common/types/session.types';
import { CentralConnectionService } from '../../central-storage/central-connection.service';
import { MicrosoftIdentityService } from '../../microsoft/identity/microsoft-identity.service';
import { OAuthTransactionStore } from '../../microsoft/identity/oauth-transaction.store';
import { OneDriveConnectionService } from '../../storage/onedrive/onedrive-connection.service';
import { UserProvisioningService, type ProvisionedUser } from '../../users/user-provisioning.service';
import { microsoftCallbackQuerySchema, type MicrosoftCallbackQuery } from '../dto/microsoft-callback.query';
import { SessionService } from './session.service';

/** Where the browser is sent after a successful callback (a path on the frontend, chosen by the server). */
export interface CallbackResult {
  redirectPath: string;
}

/**
 * The Microsoft redirect (this app has ONE registered redirect URI). A started redirect records its purpose in the
 * visitor's session, and the callback dispatches on it: sign-in here, Connect OneDrive in the storage module.
 * General session handling lives in SessionService.
 */
@Injectable()
export class MicrosoftLoginService {
  private readonly logger = new Logger(MicrosoftLoginService.name);

  constructor(
    private readonly identity: MicrosoftIdentityService,
    private readonly provisioning: UserProvisioningService,
    private readonly sessions: SessionService,
    private readonly transactions: OAuthTransactionStore,
    private readonly oneDrive: OneDriveConnectionService,
    private readonly centralStorage: CentralConnectionService,
  ) {}

  /** Starts a login: remembers state/nonce/PKCE verifier in the visitor's session, returns the Microsoft URL. */
  async start(request: Request): Promise<string> {
    const authorization = await this.identity.createAuthorizationRequest();
    this.transactions.add(request.session, authorization.state, {
      codeVerifier: authorization.codeVerifier,
      nonce: authorization.nonce,
      purpose: 'login',
    });
    return authorization.url;
  }

  /** Handles the redirect back from Microsoft. Resolves only when the flow succeeded. */
  async complete(request: Request, rawQuery: unknown): Promise<CallbackResult> {
    const parsed = microsoftCallbackQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new AuthFlowError('login_failed', 'invalid_callback_parameters');
    const query = parsed.data;

    // Single use: the pending redirect is removed whether or not the rest succeeds, so a callback cannot be replayed.
    const transaction = query.state ? this.transactions.take(request.session, query.state) : undefined;
    const purpose: OAuthPurpose = transaction?.purpose ?? 'login';

    try {
      if (query.error) throw this.mapProviderError(query.error);
      if (!query.code || !query.state) throw new AuthFlowError('login_failed', 'missing_parameters');
      if (!transaction) throw new AuthFlowError('session_expired', 'unknown_or_expired_state');

      if (purpose === 'connect_central_storage') {
        return await this.completeConnectCentralStorage(request, query.code, transaction);
      }
      return purpose === 'connect_onedrive'
        ? await this.completeConnectOneDrive(request, query.code, transaction)
        : await this.completeLogin(request, query.code, transaction);
    } catch (error) {
      // Tag the failure with its flow so the controller sends the browser back to the right page.
      throw (
        error instanceof AuthFlowError ? error : new AuthFlowError('login_failed', 'unexpected', { cause: error })
      ).withPurpose(purpose);
    }
  }

  private async completeLogin(request: Request, code: string, transaction: OAuthTransaction): Promise<CallbackResult> {
    const { identity, tokenCache } = await this.identity.redeemAuthorizationCode({
      code,
      codeVerifier: transaction.codeVerifier,
      nonce: transaction.nonce,
    });

    const user = await this.provision(identity);
    try {
      await this.sessions.establish(request, {
        // BIGINT identifiers go to the client as decimal strings, never as numbers.
        user: { id: user.id.toString(), email: user.email, displayName: user.displayName },
        identity: { issuer: identity.issuer, subject: identity.subject },
        tokenCache,
        homeAccountId: identity.homeAccountId,
      });
    } catch (error) {
      throw new AuthFlowError('service_unavailable', 'session_not_saved', { cause: error });
    }
    this.logger.log({ event: 'auth_login_succeeded', accountType: identity.accountType });
    return { redirectPath: '/' };
  }

  private async completeConnectOneDrive(
    request: Request,
    code: string,
    transaction: OAuthTransaction,
  ): Promise<CallbackResult> {
    await this.oneDrive.completeConnect(request.session, code, transaction);
    return { redirectPath: '/files?onedrive=connected' };
  }

  private async completeConnectCentralStorage(
    request: Request,
    code: string,
    transaction: OAuthTransaction,
  ): Promise<CallbackResult> {
    await this.centralStorage.completeConnect(request.session, code, transaction);
    return { redirectPath: '/admin/storage/settings?central=connected' };
  }

  private async provision(
    identity: Parameters<UserProvisioningService['resolveOrProvision']>[0],
  ): Promise<ProvisionedUser> {
    try {
      return await this.provisioning.resolveOrProvision(identity);
    } catch (error) {
      if (error instanceof AuthFlowError) throw error;
      // Database unreachable, constraint failure, ...: report it as unavailable, never as a login success.
      throw new AuthFlowError('service_unavailable', 'provisioning_failed', { cause: error });
    }
  }

  private mapProviderError(error: MicrosoftCallbackQuery['error']): AuthFlowError {
    switch (error) {
      case 'access_denied':
        return new AuthFlowError('access_denied', 'provider_access_denied');
      case 'consent_required':
      case 'interaction_required':
        return new AuthFlowError('consent_required', 'provider_consent_required');
      default:
        return new AuthFlowError('login_failed', 'provider_error');
    }
  }
}
