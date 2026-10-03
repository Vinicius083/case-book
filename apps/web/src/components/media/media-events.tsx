'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { applyMediaEvent, mediaKeys } from '@/lib/media/cache';
import { startMediaEvents } from '@/lib/media/events';

/**
 * Liga os eventos de mídia (SSE) ao cache do TanStack Query enquanto a área
 * logada está montada. Cada evento atualiza o item no cache, sem refazer a
 * lista; ao reconectar, as listas são invalidadas — o que aconteceu durante a
 * queda não é reenviado.
 */
export function MediaEvents() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      startMediaEvents({
        onEvent: (event) => {
          applyMediaEvent(queryClient, event);
        },
        onReconnect: () => {
          void queryClient.invalidateQueries({ queryKey: mediaKeys.all });
        },
      }),
    [queryClient],
  );
  return null;
}
