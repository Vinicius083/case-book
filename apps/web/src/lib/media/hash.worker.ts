// Web Worker do SHA-256: o hash de um arquivo grande não pode travar a interface.
import { sha256Incremental } from './sha256';

export interface HashRequest {
  file: Blob;
}
export type HashReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'done'; sha256: string }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HashRequest>) => void) | null;
  postMessage: (reply: HashReply) => void;
};

scope.onmessage = (event) => {
  sha256Incremental(event.data.file, {
    onProgress: (loaded, total) => {
      scope.postMessage({ type: 'progress', loaded, total });
    },
  }).then(
    (sha256) => {
      scope.postMessage({ type: 'done', sha256 });
    },
    (error: unknown) => {
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );
};
