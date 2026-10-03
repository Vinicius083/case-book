'use client';

import {
  ArrowClockwiseIcon,
  CircleNotchIcon,
  CloudSlashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react/ssr';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { retryMedia } from '@/lib/api/media';
import { upsertAsset, useServerProgress } from '@/lib/media/cache';
import { formatFacts, processingFraction, processingLabel } from '@/lib/media/format';
import { type MediaAssetResponse } from '@casebook/contracts/media';

import { MediaPicture } from './media-picture';
import { ProgressBar } from './media-progress-card';

/** Largura de uma coluna do grid da biblioteca, para o browser escolher o derivativo. */
export const GRID_SIZES =
  '(min-width: 1280px) calc((100vw - 21rem) / 4), (min-width: 768px) calc((100vw - 20rem) / 3), calc((100vw - 3.5rem) / 2)';

/** Botão "tentar de novo" de um asset que falhou no processamento. */
export function RetryButton({ asset }: { asset: MediaAssetResponse }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryMedia(asset.id),
    onSuccess: (updated) => {
      upsertAsset(queryClient, updated);
    },
    onError: (error) => {
      toast(
        error instanceof ApiError ? error.message : 'Não foi possível tentar de novo.',
        'danger',
      );
    },
  });
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={retry.isPending}
      onClick={() => {
        retry.mutate();
      }}
    >
      <ArrowClockwiseIcon aria-hidden />
      Tentar de novo
    </Button>
  );
}

interface MediaCardProps {
  asset: MediaAssetResponse;
  onOpen: (id: string) => void;
}

/**
 * Card do grid da biblioteca. Pronto, mostra a imagem; em processamento, segue o
 * card do dashboard do design (2.1): `circle-notch` pulsando, rótulo em caixa
 * alta com o percentual e barra de 3px no rodapé.
 */
export function MediaCard({ asset, onOpen }: MediaCardProps) {
  const progress = useServerProgress(asset.id);
  const processing = asset.state === 'uploaded' || asset.state === 'processing';

  return (
    <li className="group relative flex flex-col" data-state={asset.state}>
      <div className="bg-placeholder relative aspect-[4/3] overflow-hidden rounded-md border border-border">
        {asset.state === 'ready' && <MediaPicture asset={asset} sizes={GRID_SIZES} alt="" />}

        {processing && (
          <div
            className="flex size-full flex-col items-center justify-center gap-2.5 px-3 text-center"
            role="status"
          >
            <CircleNotchIcon aria-hidden className="size-6 animate-pulse-soft text-accent-text" />
            <span className="label-caps text-on-accent-tint">{processingLabel(progress)}</span>
            <ProgressBar
              className="absolute inset-x-0 bottom-0 rounded-none"
              value={processingFraction(progress)}
            />
          </div>
        )}

        {asset.state === 'pending' && (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-3 text-center">
            <CloudSlashIcon aria-hidden weight="duotone" className="size-6 text-muted" />
            <span className="label-caps">Envio não concluído</span>
            <span className="text-caption text-muted">Envie o arquivo de novo para retomar.</span>
          </div>
        )}

        {asset.state === 'failed' && (
          <div className="flex size-full flex-col items-center justify-center gap-2 px-3 text-center">
            <WarningCircleIcon aria-hidden weight="duotone" className="size-6 text-danger" />
            <span className="text-caption text-text-secondary" role="alert">
              {asset.error_message ?? 'O processamento falhou.'}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2.5 min-w-0">
        <p className="truncate text-support" title={asset.filename}>
          {asset.filename}
        </p>
        <p className="text-caption text-muted">{formatFacts(asset) || ' '}</p>
      </div>

      {/* Cobre o card inteiro: um alvo de clique só, com o nome como rótulo. */}
      <button
        type="button"
        className="absolute inset-0 rounded-md"
        aria-label={`Ver detalhes de ${asset.filename}`}
        onClick={() => {
          onOpen(asset.id);
        }}
      />

      {asset.state === 'failed' && (
        <div className="relative z-10 mt-2">
          <RetryButton asset={asset} />
        </div>
      )}
    </li>
  );
}
