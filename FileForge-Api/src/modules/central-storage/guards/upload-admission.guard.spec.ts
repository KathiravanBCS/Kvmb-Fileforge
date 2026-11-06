import { EventEmitter } from 'node:events';

import type { ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CENTRAL_MAX_FILE_BYTES, MULTIPART_OVERHEAD_BYTES } from '../central-storage.constants';
import type { CentralUploadAdmissionService } from '../central-upload-admission.service';
import { UploadAdmissionGuard, UploadOperationType } from './upload-admission.guard';

class Controller {
  @UploadOperationType('replace')
  replace() {}

  @UploadOperationType('admin_upload')
  adminUpload() {}

  undeclared() {}
}

class FakeResponse extends EventEmitter {
  writableFinished = true;
  statusCode = 200;
}

function setup(
  options: { handler?: () => void; user?: { id: string } | null; contentLength?: string; admit?: jest.Mock } = {},
) {
  const admission = {
    admit: options.admit ?? jest.fn().mockResolvedValue({ id: 5n, token: 'token-1' }),
    release: jest.fn().mockResolvedValue(true),
  };
  const response = new FakeResponse();
  const request = {
    id: 'req-77',
    headers: options.contentLength === undefined ? {} : { 'content-length': options.contentLength },
    session: options.user === null ? {} : { user: options.user ?? { id: '2' } },
  };
  const context = {
    getHandler: () => options.handler ?? Controller.prototype.replace,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  const guard = new UploadAdmissionGuard(new Reflector(), admission as unknown as CentralUploadAdmissionService);
  return { guard, admission, response, context };
}

describe('UploadAdmissionGuard', () => {
  it('admits with the signed-in user, the declared operation and the request id', async () => {
    const { guard, admission, context } = setup();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(admission.admit).toHaveBeenCalledWith(2n, 'replace', 'req-77');
  });

  it('uses the operation the route declares (admin upload)', async () => {
    const { guard, admission, context } = setup({ handler: Controller.prototype.adminUpload });
    await guard.canActivate(context);
    expect(admission.admit).toHaveBeenCalledWith(2n, 'admin_upload', 'req-77');
  });

  it('fails closed on a route that forgot to declare its operation', async () => {
    const { guard, admission, context } = setup({ handler: Controller.prototype.undeclared });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(admission.admit).not.toHaveBeenCalled();
  });

  it('refuses a request without a session user and takes no capacity', async () => {
    const { guard, admission, context } = setup({ user: null });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(admission.admit).not.toHaveBeenCalled();
  });

  it('refuses an over-size request (413) BEFORE admitting it, so it takes no capacity', async () => {
    const tooBig = String(CENTRAL_MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES + 1);
    const { guard, admission, context } = setup({ contentLength: tooBig });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(admission.admit).not.toHaveBeenCalled();
  });

  it('admits a request exactly at the limit plus multipart overhead', async () => {
    const { guard, admission, context } = setup({
      contentLength: String(CENTRAL_MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(admission.admit).toHaveBeenCalled();
  });

  it('ignores a malformed Content-Length (the upload interceptor still enforces the real size)', async () => {
    const { guard, admission, context } = setup({ contentLength: 'abc' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(admission.admit).toHaveBeenCalled();
  });

  it('passes the 429 from admission through untouched', async () => {
    const refusal = new HttpException(
      { code: 'UPLOAD_RATE_LIMITED', message: 'slow down', retryAfterSeconds: 42 },
      429,
    );
    const { guard, context } = setup({ admit: jest.fn().mockRejectedValue(refusal) });
    await expect(guard.canActivate(context)).rejects.toBe(refusal);
  });

  describe('release when the response closes', () => {
    it('does not release while the request is still running', async () => {
      const { guard, admission, context } = setup();
      await guard.canActivate(context);
      expect(admission.release).not.toHaveBeenCalled();
    });

    it.each([
      ['completed', { writableFinished: true, statusCode: 201 }],
      ['failed', { writableFinished: true, statusCode: 500 }],
      ['failed', { writableFinished: true, statusCode: 413 }],
      ['cancelled', { writableFinished: false, statusCode: 200 }],
    ])('releases with outcome "%s"', async (outcome, state) => {
      const { guard, admission, response, context } = setup();
      await guard.canActivate(context);
      Object.assign(response, state);
      response.emit('close');
      expect(admission.release).toHaveBeenCalledWith({ id: 5n, token: 'token-1' }, outcome);
    });

    it('releases exactly once even if close is emitted twice', async () => {
      const { guard, admission, response, context } = setup();
      await guard.canActivate(context);
      response.emit('close');
      response.emit('close');
      expect(admission.release).toHaveBeenCalledTimes(1);
    });

    it('a failing release is swallowed (the lease expires on its own)', async () => {
      const { guard, admission, response, context } = setup();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      admission.release.mockRejectedValue(new Error('db down'));
      await guard.canActivate(context);
      expect(() => response.emit('close')).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      expect(admission.release).toHaveBeenCalledTimes(1);
    });

    it('releases only the slot that this request was given', async () => {
      const first = setup({ admit: jest.fn().mockResolvedValue({ id: 1n, token: 'a' }) });
      const second = setup({ admit: jest.fn().mockResolvedValue({ id: 2n, token: 'b' }) });
      await first.guard.canActivate(first.context);
      await second.guard.canActivate(second.context);
      second.response.emit('close');
      expect(second.admission.release).toHaveBeenCalledWith({ id: 2n, token: 'b' }, 'completed');
      expect(first.admission.release).not.toHaveBeenCalled();
    });
  });
});
