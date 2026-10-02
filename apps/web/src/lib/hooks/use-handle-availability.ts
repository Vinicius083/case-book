import { useQuery } from '@tanstack/react-query';

import { fetchHandleAvailability } from '@/lib/api/profile';
import { handleProblem, normalizeHandle } from '@casebook/contracts/handle';

import { useDebounced } from './use-debounced';

export type HandleCheck =
  | 'idle' // vazio, ou igual ao handle atual
  | 'invalid'
  | 'reserved'
  | 'checking'
  | 'available'
  | 'taken'
  | 'unknown'; // a consulta falhou; o servidor decide no envio

const DEBOUNCE_MS = 400;

/**
 * Disponibilidade do handle enquanto a pessoa digita. Formato e lista de
 * reservados são conferidos aqui mesmo; só handle plausível vai à API, depois de
 * 400 ms sem digitação.
 */
export function useHandleAvailability(raw: string, currentHandle?: string): HandleCheck {
  const handle = normalizeHandle(raw);
  const debounced = useDebounced(handle, DEBOUNCE_MS);
  const localProblem = handle === '' ? undefined : handleProblem(handle);
  const skip = handle === '' || handle === currentHandle || localProblem !== undefined;

  const query = useQuery({
    queryKey: ['handle-availability', debounced],
    queryFn: ({ signal }) => fetchHandleAvailability(debounced, signal),
    enabled: !skip && debounced === handle,
    staleTime: 15_000,
    retry: false,
  });

  if (handle === '' || handle === currentHandle) return 'idle';
  if (localProblem) return localProblem;
  if (debounced !== handle || query.isPending) return query.isError ? 'unknown' : 'checking';
  if (query.isError) return 'unknown';
  if (query.data.available) return 'available';
  return query.data.reason ?? 'taken';
}
