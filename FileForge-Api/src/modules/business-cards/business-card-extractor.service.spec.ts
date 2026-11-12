import { HttpException, Logger } from '@nestjs/common';

import { BusinessCardExtractorService, findJsonObject } from './business-card-extractor.service';

const IMAGE = Buffer.from('fake-image-bytes');
const cardImage = (mimeType: string) => ({ bytes: IMAGE, mimeType });
const CARD_JSON = {
  fullName: 'Arun Kumar',
  jobTitle: 'Software Developer',
  companyName: 'ABC Technologies',
  department: 'Engineering',
  email: 'ARUN@example.com',
  mobile: '+91 9876543210',
  website: 'https://example.com',
  address: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
  socialLinks: { linkedin: null, github: null },
};

function groqReply(content: unknown, finish = 'stop', init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function service(apiKey: string | null = 'gsk_test_key', model = 'qwen/qwen3.8-27b') {
  return new BusinessCardExtractorService({ apiKey, model });
}

async function codeOf(promise: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as HttpException;
    const body = e.getResponse() as { code: string; message: string };
    return { status: e.getStatus(), code: body.code, message: body.message };
  }
  throw new Error('expected the call to fail');
}

describe('BusinessCardExtractorService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends the image as a base64 data URL to Groq with JSON mode, and returns validated data', async () => {
    fetchMock.mockResolvedValue(groqReply(JSON.stringify(CARD_JSON)));

    const result = await service().extract([cardImage('image/jpeg')]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer gsk_test_key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.response_format).toEqual({ type: 'json_object' });
    const image = body.messages[1].content.find((p: { type: string }) => p.type === 'image_url');
    expect(image.image_url.url).toBe(`data:image/jpeg;base64,${IMAGE.toString('base64')}`);

    expect(result.model).toBe('qwen/qwen3.8-27b');
    expect(result.data.fullName).toBe('Arun Kumar');
    expect(result.data.email).toBe('arun@example.com'); // lowercased by validation
    expect(result.raw).toEqual(CARD_JSON); // the model's own answer is kept untouched
  });

  it('sends the front and the back in order and says which is which, so they are read as ONE card', async () => {
    fetchMock.mockResolvedValue(groqReply(JSON.stringify(CARD_JSON)));
    const back = { bytes: Buffer.from('back-bytes'), mimeType: 'image/png' };

    await service().extract([cardImage('image/jpeg'), back]);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const parts = body.messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts.filter((p) => p.type === 'image_url').map((p) => p.image_url?.url)).toEqual([
      `data:image/jpeg;base64,${IMAGE.toString('base64')}`,
      `data:image/png;base64,${back.bytes.toString('base64')}`,
    ]);
    expect(parts[0].text).toMatch(/image 1 is the front.*image 2 is the back/i);
    expect(body.messages[0].content).toMatch(/SAME card/);
    expect(body.messages[0].content).toMatch(/front wins/);
  });

  it('keeps the single-photo instructions when there is no back', async () => {
    fetchMock.mockResolvedValue(groqReply(JSON.stringify(CARD_JSON)));
    await service().extract([cardImage('image/png')]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).not.toMatch(/image 2/);
    expect(body.messages[1].content.filter((p: { type: string }) => p.type === 'image_url')).toHaveLength(1);
  });

  it('copes with reasoning text and a code fence around the JSON', async () => {
    const content = `<think>Let me look at the card {not json}</think>\nHere you go:\n\`\`\`json\n${JSON.stringify(CARD_JSON)}\n\`\`\``;
    fetchMock.mockResolvedValue(groqReply(content));
    const result = await service().extract([cardImage('image/png')]);
    expect(result.data.companyName).toBe('ABC Technologies');
  });

  it('nulls a hallucinated e-mail instead of failing', async () => {
    fetchMock.mockResolvedValue(groqReply(JSON.stringify({ ...CARD_JSON, email: 'see card' })));
    const result = await service().extract([cardImage('image/png')]);
    expect(result.data.email).toBeNull();
    expect(result.data.fullName).toBe('Arun Kumar');
  });

  it('fails clearly when there is no API key, without calling Groq', async () => {
    expect(await codeOf(service(null).extract([cardImage('image/png')]))).toMatchObject({
      status: 503,
      code: 'EXTRACTION_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON at all', 'Sorry, I cannot read this card.'],
    ['an unterminated object', '{"fullName": "Arun"'],
    ['an array', '[1,2,3]'],
  ])('answers 502 EXTRACTION_INVALID_RESPONSE for %s', async (_name, content) => {
    fetchMock.mockResolvedValue(groqReply(content));
    expect(await codeOf(service().extract([cardImage('image/png')]))).toMatchObject({
      status: 502,
      code: 'EXTRACTION_INVALID_RESPONSE',
    });
  });

  it('rejects a reply that was cut off at the token limit', async () => {
    fetchMock.mockResolvedValue(groqReply('{"fullName": "Arun"', 'length'));
    expect((await codeOf(service().extract([cardImage('image/png')]))).code).toBe('EXTRACTION_INVALID_RESPONSE');
  });

  it('maps a rate limit to 429 and tells the user how long to wait', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '12' } }));
    const error = await codeOf(service().extract([cardImage('image/png')]));
    expect(error).toMatchObject({ status: 429, code: 'EXTRACTION_RATE_LIMITED' });
    expect(error.message).toContain('12 seconds');
  });

  it.each([401, 403])('maps a rejected API key (%s) to 503 without leaking the key', async (status) => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"bad key gsk_test_key"}}', { status }));
    const error = await codeOf(service().extract([cardImage('image/png')]));
    expect(error).toMatchObject({ status: 503, code: 'EXTRACTION_NOT_CONFIGURED' });
    expect(JSON.stringify(error)).not.toContain('gsk_test_key');
  });

  it('maps 413 to IMAGE_TOO_LARGE and other failures to 502', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 413 }));
    expect(await codeOf(service().extract([cardImage('image/png')]))).toMatchObject({
      status: 413,
      code: 'IMAGE_TOO_LARGE',
    });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect(await codeOf(service().extract([cardImage('image/png')]))).toMatchObject({
      status: 502,
      code: 'EXTRACTION_UNAVAILABLE',
    });
  });

  it('maps a network failure or timeout to 502 EXTRACTION_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('boom'), { name: 'TimeoutError' }));
    expect(await codeOf(service().extract([cardImage('image/png')]))).toMatchObject({
      status: 502,
      code: 'EXTRACTION_UNAVAILABLE',
    });
  });

  it('never logs the key, the image or the card text', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    fetchMock.mockResolvedValue(new Response('{"error":"card text Arun Kumar"}', { status: 500 }));
    await codeOf(service().extract([cardImage('image/png')]));
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('gsk_test_key');
    expect(logged).not.toContain(IMAGE.toString('base64'));
    expect(logged).not.toContain('Arun Kumar');
  });
});

describe('findJsonObject', () => {
  it('finds the first complete object and respects braces inside strings', () => {
    expect(findJsonObject('x {"a":"}{","b":{"c":1}} y {"d":2}')).toBe('{"a":"}{","b":{"c":1}}');
    expect(findJsonObject('no braces')).toBeNull();
    expect(findJsonObject('{"open":')).toBeNull();
  });
});
