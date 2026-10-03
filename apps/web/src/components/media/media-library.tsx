'use client';

import { MagnifyingGlassIcon, UploadSimpleIcon } from '@phosphor-icons/react/ssr';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { controlClass, Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/errors';
import { listMedia, type MediaFilters } from '@/lib/api/media';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { mediaKeys } from '@/lib/media/cache';
import { enqueueUploads, hasActiveUploads, isActive, useUploads } from '@/lib/media/uploads';
import { cn } from '@/lib/utils';
import { type MediaKind, type MediaState } from '@casebook/contracts/media';

import { MediaCard } from './media-card';
import { MediaDetailPanel } from './media-detail';
import { FileInput, MediaDropzone, PageDropOverlay } from './media-dropzone';
import { MediaProgressCard } from './media-progress-card';

type KindFilter = 'all' | MediaKind;
type StateFilter = 'all' | MediaState;

const KIND_OPTIONS = [
  { value: 'all', label: 'Tudo' },
  { value: 'image', label: 'Imagens' },
  { value: 'video', label: 'Vídeos' },
] as const satisfies readonly { value: KindFilter; label: string }[];

const STATE_OPTIONS = [
  { value: 'all', label: 'Todos os estados' },
  { value: 'ready', label: 'Prontos' },
  { value: 'processing', label: 'Processando' },
  { value: 'uploaded', label: 'Na fila' },
  { value: 'failed', label: 'Com falha' },
  { value: 'pending', label: 'Envio não concluído' },
] as const satisfies readonly { value: StateFilter; label: string }[];

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4';

/** Biblioteca de mídia (RF-LIB-1 a 4): envio, grid com filtros e painel de detalhes. */
export function MediaLibrary() {
  const queryClient = useQueryClient();
  const uploadInputId = useId();
  const searchId = useId();
  const stateId = useId();
  const [kind, setKind] = useState<KindFilter>('all');
  const [state, setState] = useState<StateFilter>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search.trim(), 300);

  const filters = useMemo<MediaFilters>(
    () => ({
      ...(kind !== 'all' && { kind }),
      ...(state !== 'all' && { state }),
      ...(q && { q }),
    }),
    [kind, state, q],
  );
  const filtered = kind !== 'all' || state !== 'all' || q !== '';

  const list = useInfiniteQuery({
    queryKey: mediaKeys.list(filters),
    queryFn: ({ pageParam, signal }) => listMedia(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const uploads = useUploads();
  const onFiles = useCallback(
    (files: File[]) => {
      enqueueUploads(files, queryClient);
    },
    [queryClient],
  );

  // Sair da página com envio em curso perde o envio: o browser pergunta antes.
  const uploading = hasActiveUploads(uploads);
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [uploading]);

  // O asset de um envio em curso nesta aba aparece só no card de progresso.
  const inFlight = new Set(
    uploads
      .filter((item) => isActive(item.status))
      .flatMap((item) => (item.mediaId ? [item.mediaId] : [])),
  );
  const items = (list.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => !inFlight.has(item.id),
  );
  const empty = list.isSuccess && items.length === 0 && uploads.length === 0;

  // Scroll infinito: busca a próxima página quando o fim do grid entra na tela.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage)
          void fetchNextPage();
      },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <>
      <PageHeader
        eyebrow="Seus arquivos"
        title="Biblioteca de mídia"
        action={
          <Button asChild variant="outline">
            <label htmlFor={uploadInputId} className="cursor-pointer">
              <UploadSimpleIcon aria-hidden />
              Enviar arquivos
              <FileInput id={uploadInputId} onFiles={onFiles} />
            </label>
          </Button>
        }
      />
      <PageDropOverlay onFiles={onFiles}>
        <p className="text-support text-muted">Os arquivos entram na sua biblioteca.</p>
      </PageDropOverlay>

      <div className="flex flex-1 flex-col gap-6 px-5 py-6 md:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            name="media-kind"
            legend="Tipo de arquivo"
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
          />
          <label htmlFor={stateId} className="sr-only">
            Estado
          </label>
          <select
            id={stateId}
            value={state}
            className={cn(controlClass, 'h-[2.625rem] w-auto pr-8 text-support')}
            onChange={(event) => {
              setState(event.target.value as StateFilter);
            }}
          >
            {STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <label htmlFor={searchId} className="sr-only">
              Buscar por nome
            </label>
            <MagnifyingGlassIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              id={searchId}
              type="search"
              placeholder="Buscar por nome"
              value={search}
              className="h-[2.625rem] pl-10 text-support"
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </div>
        </div>

        {uploads.length > 0 && (
          <section aria-label="Envios">
            <ul className="grid gap-3 lg:grid-cols-2">
              {uploads.map((item) => (
                <MediaProgressCard key={item.id} item={item} />
              ))}
            </ul>
          </section>
        )}

        {list.isError && (
          <Notice tone="danger">
            {list.error instanceof ApiError
              ? list.error.message
              : 'Não foi possível carregar a biblioteca.'}{' '}
            <Button
              variant="link"
              size="inline"
              onClick={() => {
                void list.refetch();
              }}
            >
              Tentar de novo
            </Button>
          </Notice>
        )}

        {list.isPending && (
          <div className={GRID} aria-hidden>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3]" />
            ))}
          </div>
        )}

        {empty && !filtered && (
          <div className="flex flex-1 flex-col justify-center">
            <MediaDropzone onFiles={onFiles} />
            <p className="mx-auto mt-5 max-w-[30rem] text-center text-text-secondary">
              Aqui ficam as imagens que você enviar, já convertidas para a web em vários tamanhos.
            </p>
          </div>
        )}
        {empty && filtered && (
          <p className="py-16 text-center text-text-secondary" role="status">
            Nenhum arquivo com esses filtros.
          </p>
        )}

        {items.length > 0 && (
          <ul className={GRID} aria-label="Arquivos">
            {items.map((asset) => (
              <MediaCard key={asset.id} asset={asset} onOpen={setOpenId} />
            ))}
          </ul>
        )}
        <div ref={sentinel} aria-hidden />
        {list.isFetchingNextPage && (
          <p className="text-center text-support text-muted" role="status">
            Carregando mais…
          </p>
        )}

        <p className="mt-auto border-t border-border pt-5 text-caption text-muted">
          Nenhum arquivo é recomprimido mais de uma vez: cada tamanho sai direto do original, que
          fica guardado como você enviou.
        </p>
      </div>

      <MediaDetailPanel
        mediaId={openId}
        onClose={() => {
          setOpenId(null);
        }}
      />
    </>
  );
}
