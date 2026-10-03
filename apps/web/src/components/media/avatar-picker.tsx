'use client';

import { CheckIcon, XIcon } from '@phosphor-icons/react/ssr';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { listMedia, type MediaFilters } from '@/lib/api/media';
import { type Me, updateProfile } from '@/lib/api/profile';
import { ME_QUERY_KEY } from '@/lib/hooks/use-me';
import { mediaKeys } from '@/lib/media/cache';
import { enqueueUploads, useUploads } from '@/lib/media/uploads';
import { cn } from '@/lib/utils';

import { MediaDropzone } from './media-dropzone';
import { MediaListItem } from './media-list-item';
import { MediaProgressCard } from './media-progress-card';

/** Só imagens prontas servem de foto: as demais ainda não têm o que mostrar. */
const READY_IMAGES: MediaFilters = { kind: 'image', state: 'ready' };

/**
 * Foto de perfil: mostra a atual e abre o seletor ("Trocar foto", design 1.4).
 * No seletor dá para escolher uma imagem pronta da biblioteca ou enviar uma
 * nova, pelo mesmo fluxo de upload; ela entra na lista quando fica pronta.
 */
export function AvatarPicker({ me, className }: { me: Me; className?: string }) {
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const { profile } = me.me;

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const save = useMutation({
    mutationFn: (mediaId: string | null) => {
      // O ETag é o da última leitura do servidor, não o da montagem.
      const current = queryClient.getQueryData<Me>(ME_QUERY_KEY) ?? me;
      return updateProfile({ avatar_media_id: mediaId }, current.etag);
    },
    onSuccess: (updated, mediaId) => {
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      setOpen(false);
      toast(mediaId ? 'Foto de perfil atualizada.' : 'Foto de perfil removida.', 'success');
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
        toast('Seu perfil mudou em outra aba. Tente de novo.', 'danger');
        return;
      }
      toast(
        error instanceof ApiError ? error.message : 'Não foi possível trocar a foto.',
        'danger',
      );
    },
  });

  return (
    <div className={cn('flex items-center gap-[1.125rem]', className)}>
      <Avatar
        name={profile.display_name}
        src={profile.avatar_url}
        className="size-[4.75rem] text-[1.625rem]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(true);
          }}
        >
          {profile.avatar_media_id ? 'Trocar foto' : 'Escolher foto'}
        </Button>
        {profile.avatar_media_id && (
          <Button
            variant="ghost"
            size="sm"
            loading={save.isPending && save.variables === null}
            onClick={() => {
              save.mutate(null);
            }}
          >
            Remover
          </Button>
        )}
      </div>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => {
          setOpen(false);
        }}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
        className="m-auto max-h-[min(44rem,calc(100dvh-2rem))] w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-border bg-bg p-0 text-text shadow-dialog backdrop:bg-black/60"
      >
        {open && (
          <div className="flex max-h-[inherit] flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <h2 id={titleId} className="text-card">
                Foto de perfil
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Fechar"
                onClick={() => {
                  setOpen(false);
                }}
              >
                <XIcon aria-hidden />
              </Button>
            </header>
            <PickerBody
              current={profile.avatar_media_id}
              saving={save.isPending ? (save.variables ?? undefined) : undefined}
              onPick={(id) => {
                save.mutate(id);
              }}
            />
          </div>
        )}
      </dialog>
    </div>
  );
}

function PickerBody({
  current,
  saving,
  onPick,
}: {
  current: string | null;
  saving: string | undefined;
  onPick: (mediaId: string) => void;
}) {
  const queryClient = useQueryClient();
  const uploads = useUploads();
  const images = useInfiniteQuery({
    queryKey: mediaKeys.list(READY_IMAGES),
    queryFn: ({ pageParam, signal }) => listMedia(READY_IMAGES, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = images.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
      <MediaDropzone
        compact
        onFiles={(files) => {
          enqueueUploads(files, queryClient);
        }}
      />
      {uploads.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Envios">
          {uploads.map((item) => (
            <MediaProgressCard key={item.id} item={item} />
          ))}
        </ul>
      )}

      {images.isError && <Notice tone="danger">Não foi possível carregar suas imagens.</Notice>}
      {images.isSuccess && items.length === 0 && (
        <p className="py-4 text-center text-support text-muted">
          Nenhuma imagem pronta na biblioteca ainda. Envie uma acima: ela aparece aqui quando
          terminar de processar.
        </p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col" aria-label="Imagens da biblioteca">
          {items.map((asset) => (
            <li key={asset.id} className="border-t border-border first:border-t-0">
              <button
                type="button"
                aria-pressed={asset.id === current}
                disabled={saving !== undefined}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2.5 hover:bg-surface disabled:opacity-60"
                onClick={() => {
                  onPick(asset.id);
                }}
              >
                <MediaListItem asset={asset} />
                {asset.id === current && (
                  <span className="flex shrink-0 items-center gap-1 text-caption text-accent-text">
                    <CheckIcon aria-hidden className="size-4" />
                    Atual
                  </span>
                )}
                {asset.id === saving && (
                  <span className="shrink-0 text-caption text-muted" role="status">
                    Salvando…
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {images.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          loading={images.isFetchingNextPage}
          onClick={() => {
            void images.fetchNextPage();
          }}
        >
          Carregar mais
        </Button>
      )}
    </div>
  );
}
