import { describe, expect, it } from 'vitest';

import { createSseParser } from './sse';

describe('createSseParser', () => {
  it('monta eventos mesmo quando chegam partidos em pedaços', () => {
    const parse = createSseParser();
    expect(parse('retry: 3000\n: conectado\n\nevent: media.upd')).toEqual([]);
    expect(parse('ated\ndata: {"a":')).toEqual([]);
    expect(parse('1}\n\nevent: media.updated\ndata: {"a":2}\n\n')).toEqual([
      { event: 'media.updated', data: '{"a":1}' },
      { event: 'media.updated', data: '{"a":2}' },
    ]);
  });

  it('ignora comentários de heartbeat e aceita CRLF', () => {
    const parse = createSseParser();
    expect(parse(': ping\n\n: ping\n\n')).toEqual([]);
    expect(parse('data: x\r\ndata: y\r\n\r\n')).toEqual([{ event: 'message', data: 'x\ny' }]);
  });
});
