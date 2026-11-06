import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { MicrosoftApiError } from '../../microsoft/microsoft.errors';

/**
 * Turns a failed Microsoft call into an HTTP error the browser can act on. Codes are stable (the frontend branches
 * on them); messages are generic: Graph response bodies can echo file names or personal data and are never forwarded.
 */
export function mapMicrosoftError(error: MicrosoftApiError): HttpException {
  switch (error.kind) {
    case 'reauth_required':
      return new UnauthorizedException({
        code: 'MICROSOFT_REAUTH_REQUIRED',
        message: 'Your Microsoft session has to be renewed. Please sign in again.',
      });
    case 'consent_required':
      return new ForbiddenException({
        code: 'ONEDRIVE_CONSENT_REQUIRED',
        message: 'FileForge needs your permission to use OneDrive. Connect OneDrive to continue.',
      });
    case 'forbidden':
      return new ForbiddenException({ code: 'ONEDRIVE_FORBIDDEN', message: 'OneDrive refused this operation.' });
    case 'not_found':
      return new NotFoundException({ code: 'ITEM_NOT_FOUND', message: 'That file or folder was not found.' });
    case 'conflict':
      return new ConflictException({ code: 'FILE_ALREADY_EXISTS', message: 'A file with that name already exists.' });
    case 'throttled':
      return new HttpException(
        {
          code: 'ONEDRIVE_THROTTLED',
          message: error.retryAfterSeconds
            ? `OneDrive is busy. Try again in ${error.retryAfterSeconds} seconds.`
            : 'OneDrive is busy. Try again shortly.',
        },
        429,
      );
    case 'unavailable':
      return new ServiceUnavailableException({
        code: 'ONEDRIVE_UNAVAILABLE',
        message: 'OneDrive is temporarily unavailable.',
      });
    default:
      return new BadGatewayException({ code: 'ONEDRIVE_ERROR', message: 'OneDrive returned an unexpected error.' });
  }
}

/** Runs a Graph operation, converting Microsoft failures to HTTP errors and letting everything else through. */
export async function withGraphErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw error instanceof MicrosoftApiError ? mapMicrosoftError(error) : error;
  }
}
