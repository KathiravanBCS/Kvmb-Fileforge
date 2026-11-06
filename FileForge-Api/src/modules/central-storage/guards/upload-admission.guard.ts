import type { Request, Response } from 'express';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { describeError } from '../../../common/utils/logging.util';
import { CENTRAL_MAX_FILE_BYTES, MULTIPART_OVERHEAD_BYTES } from '../central-storage.constants';
import {
  CentralUploadAdmissionService,
  type SlotOutcome,
  type UploadOperation,
} from '../central-upload-admission.service';

const UPLOAD_OPERATION_KEY = 'centralUploadOperation';

/** Declares what an upload route is, so the right limit applies. A route that forgets it is refused (fails closed). */
export const UploadOperationType = (operation: UploadOperation) => SetMetadata(UPLOAD_OPERATION_KEY, operation);

/** How the request ended, for the slot's record. */
function outcomeOf(response: Response): SlotOutcome {
  if (!response.writableFinished) return 'cancelled'; // the browser went away before the answer was sent
  return response.statusCode >= 400 ? 'failed' : 'completed';
}

/**
 * Admission control for upload and replacement routes. It runs AFTER the global authentication and CSRF guards (and the
 * administrator guard on admin routes) and BEFORE the upload interceptor reads a single byte of the body, so:
 *  - an unauthenticated, CSRF-failing or non-administrator request never takes capacity;
 *  - an over-limit user is refused (429 + retry time) without their file ever being received;
 *  - an oversized request is refused (413) before it is admitted, so it takes no capacity either.
 * The slot is released when the response closes, on success, failure or cancellation.
 */
@Injectable()
export class UploadAdmissionGuard implements CanActivate {
  private readonly logger = new Logger(UploadAdmissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly admission: CentralUploadAdmissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation = this.reflector.get<UploadOperation | undefined>(UPLOAD_OPERATION_KEY, context.getHandler());
    if (!operation)
      throw new InternalServerErrorException({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const user = request.session?.user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied.' });

    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > CENTRAL_MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `Files up to ${CENTRAL_MAX_FILE_BYTES / (1024 * 1024)} MB can be uploaded.`,
      });
    }

    const slot = await this.admission.admit(
      BigInt(user.id),
      operation,
      typeof request.id === 'string' ? request.id : undefined,
    );
    response.once('close', () => {
      void this.admission.release(slot, outcomeOf(response)).catch((error: unknown) => {
        // Not fatal: the slot's lease expires on its own and frees it.
        this.logger.warn({ event: 'central_upload_slot_release_failed', error: describeError(error) });
      });
    });
    return true;
  }
}
