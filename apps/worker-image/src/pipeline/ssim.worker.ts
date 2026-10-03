// Thread de medição do SSIM (ver `ssim-pool.ts`). A conta é JavaScript puro e
// ocuparia a thread principal; aqui ela corre em paralelo com os encodes.
import { extname } from 'node:path';
import { parentPort } from 'node:worker_threads';

import type { SsimReply, SsimRequest } from './ssim-pool.js';
import type * as SsimModule from './ssim.js';

if (!parentPort) throw new Error('ssim.worker só roda como worker thread');
const port = parentPort;

// Sem import relativo estático: nos testes este arquivo roda do fonte (.ts), e o
// Node não troca `.js` por `.ts` ao resolver. O vizinho vem com a mesma extensão.
const { measureEncoded, prepareFrame } = (await import(
  new URL(`./ssim${extname(import.meta.url)}`, import.meta.url).href
)) as typeof SsimModule;

port.on('message', (request: SsimRequest) => {
  void (async (): Promise<SsimReply> => {
    try {
      return request.type === 'prepare'
        ? { ok: true, type: 'prepare', value: prepareFrame(request.frame) }
        : {
            ok: true,
            type: 'measure',
            value: await measureEncoded(request.reference, request.encoded, request.withAlpha),
          };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  })().then((reply) => {
    port.postMessage(reply);
  });
});
