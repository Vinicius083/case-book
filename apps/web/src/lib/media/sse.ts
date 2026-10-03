/** Um evento SSE já montado: nome (`event:`) e dados (`data:`, linhas unidas por `\n`). */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Parser incremental de `text/event-stream`: recebe os pedaços como chegam da
 * rede (um evento pode vir partido em vários) e devolve os eventos completos.
 * Comentários (`: ping`) e campos que não usamos (`id`, `retry`) são ignorados.
 */
export function createSseParser(): (chunk: string) => SseMessage[] {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  return (chunk) => {
    buffer += chunk;
    const messages: SseMessage[] = [];
    for (;;) {
      const end = buffer.search(/\r?\n/);
      if (end === -1) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + (buffer[end] === '\r' ? 2 : 1));

      if (line === '') {
        // Linha em branco fecha o evento.
        if (data.length > 0) messages.push({ event: event || 'message', data: data.join('\n') });
        event = '';
        data = [];
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    return messages;
  };
}
