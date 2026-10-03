'use client';

import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  WarningCircleIcon,
  XIcon,
} from '@phosphor-icons/react/ssr';

import { Button } from '@/components/ui/button';
import { formatBytes, uploadLabel } from '@/lib/media/format';
import {
  cancelUpload,
  dismissUpload,
  isActive,
  retryUpload,
  type UploadItem,
} from '@/lib/media/uploads';
import { cn } from '@/lib/utils';

/** Barra de progresso de 3px do design. Sem `value`, pulsa (etapa que não mede). */
export function ProgressBar({
  value,
  className,
}: {
  value?: number | undefined;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(value !== undefined && { 'aria-valuenow': Math.round(value * 100) })}
      className={cn('h-[3px] overflow-hidden rounded-full bg-track', className)}
    >
      <div
        className={cn(
          'h-full rounded-full bg-accent transition-[width] duration-300',
          value === undefined && 'w-1/3 animate-pulse-soft',
        )}
        style={value === undefined ? undefined : { width: `${String(Math.round(value * 100))}%` }}
      />
    </div>
  );
}

/**
 * Card de um arquivo sendo enviado por esta aba (design 2.2): borda e fundo em
 * tom de accent, nome e percentual, barra de 3px e duas linhas de status.
 */
export function MediaProgressCard({ item }: { item: UploadItem }) {
  const active = isActive(item.status);
  const failed = item.status === 'failed';
  const measured = item.status === 'hashing' || item.status === 'uploading';

  return (
    <li
      className={cn(
        'rounded-md border px-4 py-3.5',
        failed ? 'border-danger-border bg-danger-tint' : 'border-accent/50 bg-accent-tint',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-support" title={item.name}>
              {item.name}
            </p>
            {measured && (
              <span className="text-support text-on-accent-tint tabular-nums">
                {String(Math.round(item.progress * 100))}%
              </span>
            )}
          </div>
          {active && (
            <ProgressBar className="mt-2.5" value={measured ? item.progress : undefined} />
          )}
          <p
            className={cn(
              'mt-2 flex items-center gap-1.5 text-caption',
              failed ? 'text-danger' : 'text-on-accent-tint',
            )}
            role={failed ? 'alert' : 'status'}
          >
            {item.status === 'duplicate' && (
              <CheckCircleIcon aria-hidden weight="duotone" className="size-4" />
            )}
            {failed && (
              <WarningCircleIcon aria-hidden weight="duotone" className="size-4 shrink-0" />
            )}
            {failed ? (item.error ?? uploadLabel(item)) : uploadLabel(item)}
          </p>
          <p className="mt-0.5 text-caption text-muted">
            {item.status === 'duplicate'
              ? 'Nada foi enviado de novo; o arquivo já está na sua biblioteca.'
              : formatBytes(item.size)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {(failed || item.status === 'cancelled') && item.retryable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                retryUpload(item.id);
              }}
            >
              <ArrowClockwiseIcon aria-hidden />
              Tentar de novo
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={active ? `Cancelar o envio de ${item.name}` : `Dispensar ${item.name}`}
            onClick={() => {
              if (active) cancelUpload(item.id);
              else dismissUpload(item.id);
            }}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}
