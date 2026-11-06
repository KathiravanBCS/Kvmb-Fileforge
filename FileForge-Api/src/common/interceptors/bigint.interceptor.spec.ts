import { lastValueFrom, of } from 'rxjs';

import { CallHandler, ExecutionContext } from '@nestjs/common';

import { BigIntInterceptor } from './bigint.interceptor';

async function run(value: unknown): Promise<unknown> {
  const handler: CallHandler = { handle: () => of(value) };
  return lastValueFrom(new BigIntInterceptor().intercept({} as ExecutionContext, handler));
}

describe('BigIntInterceptor', () => {
  it('serializes BIGINT above 2^53 as an exact decimal string (a Number would corrupt it)', async () => {
    const id = 9007199254740993n; // Number.MAX_SAFE_INTEGER + 2
    expect(Number(id).toString()).not.toBe('9007199254740993'); // proves a Number loses precision
    expect(await run({ id })).toEqual({ id: '9007199254740993' });
  });

  it('converts nested objects and arrays and keeps other values intact', async () => {
    const when = new Date('2026-11-04T00:00:00Z');
    const result = (await run({ rows: [{ id: 1n, at: when, name: null, n: 5 }], total: 2n })) as {
      rows: { id: string; at: Date; name: null; n: number }[];
      total: string;
    };
    expect(result.rows[0]).toEqual({ id: '1', at: when, name: null, n: 5 });
    expect(result.total).toBe('2');
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('leaves streams and other class instances alone (a download must not be walked or altered)', async () => {
    const { StreamableFile } = await import('@nestjs/common');
    const { Readable } = await import('node:stream');
    const stream = Readable.from([Buffer.from('bytes')]);
    const file = new StreamableFile(stream);

    expect(await run(file)).toBe(file);
    expect(file.getStream()).toBe(stream);
    const chunks: Buffer[] = [];
    for await (const chunk of file.getStream()) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe('bytes');
  });

  it('does not recurse into self-referencing class instances (streams are full of such cycles)', async () => {
    class Node {
      readonly self: Node = this;
      readonly id = 1n;
    }
    const node = new Node();
    // Walking this would overflow the stack; it is returned as is.
    expect(await run(node)).toBe(node);
    // Plain data around it is still converted.
    expect(await run({ id: 2n, payload: node })).toEqual({ id: '2', payload: node });
  });

  it('keeps Buffers and Dates inside plain objects intact', async () => {
    const buffer = Buffer.from('x');
    const date = new Date('2026-01-01T00:00:00Z');
    expect(await run({ buffer, date, size: 3n })).toEqual({ buffer, date, size: '3' });
  });

  it('passes through null, undefined and primitives', async () => {
    expect(await run(null)).toBeNull();
    expect(await run(undefined)).toBeUndefined();
    expect(await run('text')).toBe('text');
  });
});
