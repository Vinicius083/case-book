import { useQuery } from '@tanstack/react-query';

import { fetchMe } from '@/lib/api/profile';

export const ME_QUERY_KEY = ['me'] as const;

/** Usuário logado + perfil, com o ETag que a edição de perfil devolve em `If-Match`. */
export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
}
