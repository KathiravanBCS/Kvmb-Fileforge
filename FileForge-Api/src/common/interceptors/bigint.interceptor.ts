import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

// JSON.stringify throws on BigInt, and converting to Number would silently lose precision above 2^53.
// PostgreSQL BIGINT values are therefore always serialized as decimal strings.
// Only arrays and plain objects are walked: streams, Dates, Buffers and other class instances (e.g. the StreamableFile
// of a download) are left alone, which also keeps this from looping on their internal circular references.
function convertBigInt(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(convertBigInt);
  if (typeof value === 'object' && isPlainObject(value)) {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = convertBigInt(record[key]);
    }
  }
  return value;
}

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => convertBigInt(data)));
  }
}
