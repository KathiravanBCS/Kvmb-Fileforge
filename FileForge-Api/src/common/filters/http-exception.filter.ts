import type { Request, Response } from 'express';

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

import { describeError } from '../utils/logging.util';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Every error leaves the API as `{ error: { code, message, requestId } }`.
 * Unexpected errors become a generic 500: stack traces and internals never reach the browser.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    // Set by pino-http (see genReqId in AppModule): always a server-generated UUID.
    const requestId = typeof request.id === 'string' ? request.id : '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred.';
    let retryAfterSeconds: number | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = DEFAULT_CODES[status] ?? 'ERROR';
      message = exception.message;
      if (typeof body === 'object' && body !== null) {
        const custom = body as { code?: unknown; message?: unknown; retryAfterSeconds?: unknown };
        if (typeof custom.retryAfterSeconds === 'number' && custom.retryAfterSeconds > 0) {
          retryAfterSeconds = Math.ceil(custom.retryAfterSeconds);
        }
        if (typeof custom.code === 'string') code = custom.code;
        if (typeof custom.message === 'string') message = custom.message;
      }
    } else {
      this.logger.error({ event: 'unhandled_exception', requestId, error: describeError(exception) });
    }

    // A rate-limited caller is told when to come back, in the body and (standard) in the Retry-After header.
    if (retryAfterSeconds !== undefined) response.setHeader('Retry-After', String(retryAfterSeconds));
    response.status(status).json({
      error: { code, message, requestId, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) },
    });
  }
}
