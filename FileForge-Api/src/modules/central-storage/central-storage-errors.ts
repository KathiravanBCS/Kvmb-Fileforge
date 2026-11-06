import {
  BadGatewayException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { MicrosoftApiError } from '../microsoft/microsoft.errors';

/** Uniform answer for "no such file" AND "not yours": a user can never learn that someone else's file exists. */
export function fileNotFound(): NotFoundException {
  return new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'File not found.' });
}

export function notConnected(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'CENTRAL_STORAGE_NOT_CONNECTED',
    message: 'File storage is not available right now. Please contact the administrator.',
  });
}

export function reconnectRequired(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'CENTRAL_STORAGE_RECONNECT_REQUIRED',
    message: 'File storage is not available right now. Please contact the administrator.',
  });
}

export function quotaExceeded(): HttpException {
  return new HttpException(
    { code: 'CENTRAL_STORAGE_QUOTA_EXCEEDED', message: 'The storage is full. Please contact the administrator.' },
    507,
  );
}

const QUOTA_GRAPH_CODES = new Set(['quotaLimitReached', 'insufficientStorage', 'quotaLimitExceeded']);

/** OneDrive out of space (HTTP 507 or a quota error code). */
export function isQuotaError(error: MicrosoftApiError): boolean {
  return error.status === 507 || (error.graphCode !== undefined && QUOTA_GRAPH_CODES.has(error.graphCode));
}

/**
 * Maps a failed Graph call to an HTTP error. Codes are stable. A 401/403 from Microsoft is NEVER forwarded as 401:
 * the frontend signs the user out on 401 UNAUTHENTICATED, and a lost central authorization is not the user's doing.
 */
export function mapCentralGraphError(error: MicrosoftApiError): HttpException {
  if (isQuotaError(error)) return quotaExceeded();
  switch (error.kind) {
    case 'reauth_required':
    case 'consent_required':
      return reconnectRequired();
    case 'not_found':
      return fileNotFound();
    case 'conflict':
      return new ConflictException({ code: 'FILE_ALREADY_EXISTS', message: 'That file already exists.' });
    case 'throttled':
      return new HttpException(
        {
          code: 'CENTRAL_STORAGE_THROTTLED',
          message: error.retryAfterSeconds
            ? `Storage is busy. Try again in ${error.retryAfterSeconds} seconds.`
            : 'Storage is busy. Try again shortly.',
        },
        429,
      );
    case 'unavailable':
      return new ServiceUnavailableException({
        code: 'CENTRAL_STORAGE_UNAVAILABLE',
        message: 'File storage is temporarily unavailable.',
      });
    default:
      return new BadGatewayException({ code: 'CENTRAL_STORAGE_ERROR', message: 'File storage returned an error.' });
  }
}

/** Runs a Graph operation, converting Microsoft failures to HTTP errors and letting everything else through. */
export async function withCentralGraphErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw error instanceof MicrosoftApiError ? mapCentralGraphError(error) : error;
  }
}
