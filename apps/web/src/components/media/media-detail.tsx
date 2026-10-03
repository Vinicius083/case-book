'use client';

import { TrashIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react/ssr';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, fieldAria } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { deleteMedia, getMedia, updateMedia } from '@/lib/api/media';
import { mediaKeys, removeAsset, upsertAsset } from '@/lib/media/cache';
import { colorLabel, formatBytes } from '@/lib/media/format';
import { cn } from '@/lib/utils';
import {
  type MediaAssetDetailResponse,
  type MediaInUseProblem,
  type UpdateMediaInput,
  updateMediaSchema,
} from '@casebook/contracts/media';

import { RetryButton } from './media-card';
import { MediaPicture } from './media-picture';

const ALT_MAX = 500;
const SSIM_TARGET = 0.985;

interface MediaDetailPanelProps {
  /** Asset aberto; `null` fecha o painel. */
  mediaId: string | null;
  onClose: () => void;
}

/**
 * Painel de detalhes de um asset (RF-LIB-4): preview, dimensões, derivativos com
 * SSIM e qualidade, paleta, EXIF, edição de nome e texto alternativo, e apagar.
 * Um `<dialog>` modal: o foco fica preso nele e Esc fecha.
 */
export function MediaDetailPanel({ mediaId, onClose }: MediaDetailPanelProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (mediaId && !dialog.open) dialog.showModal();
    if (!mediaId && dialog.open) dialog.close();
  }, [mediaId]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // Clique no fundo (o próprio <dialog>, fora da caixa) fecha.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-[36rem] border-l border-border bg-bg p-0 text-text shadow-dialog backdrop:bg-black/60"
    >
      {mediaId && (
        <DetailBody key={mediaId} mediaId={mediaId} titleId={titleId} onClose={onClose} />
      )}
    </dialog>
  );
}

function DetailBody({
  mediaId,
  titleId,
  onClose,
}: {
  mediaId: string;
  titleId: string;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: mediaKeys.detail(mediaId),
    queryFn: ({ signal }) => getMedia(mediaId, signal),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 md:px-7">
        <h2 id={titleId} className="min-w-0 truncate text-card">
          {detail.data?.filename ?? 'Detalhes do arquivo'}
        </h2>
        <Button variant="ghost" size="icon" aria-label="Fechar detalhes" onClick={onClose}>
          <XIcon aria-hidden />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-6 md:px-7">
        {detail.isPending && <Skeleton className="aspect-[4/3] w-full" />}
        {detail.isError && (
          <Notice tone="danger">
            {detail.error instanceof ApiError
              ? detail.error.message
              : 'Não foi possível abrir o arquivo.'}
          </Notice>
        )}
        {detail.data && <DetailContent asset={detail.data} onClose={onClose} />}
      </div>
    </div>
  );
}

function DetailContent({
  asset,
  onClose,
}: {
  asset: MediaAssetDetailResponse;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="bg-placeholder flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-border">
        {asset.state === 'ready' ? (
          <MediaPicture
            asset={asset}
            fit="contain"
            eager
            sizes="(min-width: 640px) 32rem, 100vw"
            alt={asset.alt_text ?? asset.filename}
          />
        ) : (
          <p className="label-caps px-4 text-center">{STATE_LABELS[asset.state]}</p>
        )}
      </div>

      {asset.state === 'failed' && (
        <Notice tone="danger">
          <p>{asset.error_message ?? 'O processamento falhou.'}</p>
          <div className="mt-3">
            <RetryButton asset={asset} />
          </div>
        </Notice>
      )}

      <EditForm asset={asset} />

      <Section title="Arquivo">
        <Facts
          rows={[
            [
              'Dimensões',
              asset.width && asset.height
                ? `${String(asset.width)} × ${String(asset.height)} px`
                : null,
            ],
            [
              'Original',
              asset.size_bytes ? `${formatBytes(asset.size_bytes)} · ${asset.mime}` : asset.mime,
            ],
            ['Perfil de cor', asset.exif ? colorLabel(asset.exif.color) : null],
            [
              'Enviado em',
              new Date(asset.created_at).toLocaleString('pt-BR', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            ],
          ]}
        />
      </Section>

      {asset.derivatives.length > 0 && (
        <Section title="Derivativos">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-support tabular-nums">
              <thead>
                <tr className="text-caption text-muted">
                  <th scope="col" className="pb-2 font-normal">
                    Formato
                  </th>
                  <th scope="col" className="pb-2 font-normal">
                    Largura
                  </th>
                  <th scope="col" className="pb-2 font-normal">
                    Tamanho
                  </th>
                  <th scope="col" className="pb-2 font-normal">
                    SSIM
                  </th>
                  <th scope="col" className="pb-2 font-normal">
                    Qualidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {asset.derivatives.map((d) => (
                  <tr key={d.url} className="border-t border-border" data-format={d.format}>
                    <td className="py-1.5 uppercase">{d.format}</td>
                    <td className="py-1.5">{d.width ? `${String(d.width)} px` : '—'}</td>
                    <td className="py-1.5">{formatBytes(d.bytes)}</td>
                    <td
                      className={cn('py-1.5', d.ssim_target_met === false && 'text-danger')}
                      data-ssim={d.ssim ?? ''}
                    >
                      {d.ssim === null
                        ? '—'
                        : d.ssim.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}
                    </td>
                    <td className="py-1.5">{d.quality ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {asset.derivatives.some((d) => d.ssim_target_met === false) && (
            <p className="mt-3 flex items-start gap-1.5 text-caption text-text-secondary">
              <WarningCircleIcon
                aria-hidden
                weight="duotone"
                className="mt-0.5 size-4 shrink-0 text-danger"
              />
              Em vermelho: nem a qualidade máxima do formato chegou a SSIM{' '}
              {SSIM_TARGET.toLocaleString('pt-BR')}. Acontece com ruído fino; o derivativo é servido
              assim mesmo.
            </p>
          )}
        </Section>
      )}

      {asset.palette && (
        <Section title="Paleta">
          <ul className="flex flex-col gap-2">
            {asset.palette.colors.map((color) => (
              <li key={color.hex} className="flex items-center gap-3 text-support">
                <span
                  aria-hidden
                  className="size-8 shrink-0 rounded-sm border border-border"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="w-[4.75rem] uppercase tabular-nums">{color.hex}</span>
                <span className="text-caption text-muted tabular-nums">
                  {Math.round(color.ratio * 100)}% · contraste{' '}
                  {color.contrast_white.toLocaleString('pt-BR')}:1 com branco,{' '}
                  {color.contrast_black.toLocaleString('pt-BR')}:1 com preto
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {asset.exif && hasExif(asset.exif) && (
        <Section title="Câmera">
          <Facts
            rows={[
              [
                'Câmera',
                [asset.exif.camera_make, asset.exif.camera_model].filter(Boolean).join(' ') || null,
              ],
              ['Lente', asset.exif.lens],
              ['ISO', asset.exif.iso === null ? null : String(asset.exif.iso)],
              [
                'Abertura',
                asset.exif.aperture === null
                  ? null
                  : `f/${asset.exif.aperture.toLocaleString('pt-BR')}`,
              ],
              ['Exposição', formatExposure(asset.exif.exposure_time)],
              [
                'Distância focal',
                asset.exif.focal_length_mm === null
                  ? null
                  : `${asset.exif.focal_length_mm.toLocaleString('pt-BR')} mm`,
              ],
            ]}
          />
        </Section>
      )}

      <DeleteSection asset={asset} onDeleted={onClose} />
    </div>
  );
}

const STATE_LABELS = {
  pending: 'Envio não concluído',
  uploaded: 'Na fila',
  processing: 'Processando',
  ready: 'Pronto',
  failed: 'Falhou',
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="eyebrow mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [label: string, value: string | null][] }) {
  return (
    <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-support">
      {rows
        .filter((row): row is [string, string] => row[1] !== null && row[1] !== '')
        .map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function hasExif(exif: NonNullable<MediaAssetDetailResponse['exif']>): boolean {
  return [
    exif.camera_make,
    exif.camera_model,
    exif.lens,
    exif.iso,
    exif.aperture,
    exif.exposure_time,
  ].some((value) => value !== null);
}

function formatExposure(seconds: number | null): string | null {
  if (seconds === null) return null;
  return seconds >= 1
    ? `${seconds.toLocaleString('pt-BR')} s`
    : `1/${String(Math.round(1 / seconds))} s`;
}

/** Nome e texto alternativo (RF-LIB-2), editados no próprio painel. */
function EditForm({ asset }: { asset: MediaAssetDetailResponse }) {
  const queryClient = useQueryClient();
  const nameId = useId();
  const altId = useId();
  const [filename, setFilename] = useState(asset.filename);
  const [alt, setAlt] = useState(asset.alt_text ?? '');
  const [errors, setErrors] = useState<{ filename?: string; alt_text?: string }>({});

  const dirty = filename !== asset.filename || alt !== (asset.alt_text ?? '');
  const save = useMutation({
    mutationFn: (patch: UpdateMediaInput) => updateMedia(asset.id, patch),
    onSuccess: (updated) => {
      upsertAsset(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: mediaKeys.detail(asset.id) });
      setFilename(updated.filename);
      setAlt(updated.alt_text ?? '');
      toast('Alterações salvas.', 'success');
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        toast(error instanceof ApiError ? error.message : 'Não foi possível salvar.', 'danger');
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = updateMediaSchema.safeParse({ filename, alt_text: alt });
        if (!parsed.success) {
          setErrors(
            Object.fromEntries(
              parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
            ),
          );
          return;
        }
        setErrors({});
        save.mutate(parsed.data);
      }}
    >
      <Field id={nameId} label="Nome" error={errors.filename}>
        <Input
          {...fieldAria(nameId, errors.filename)}
          value={filename}
          maxLength={255}
          onChange={(event) => {
            setFilename(event.target.value);
          }}
        />
      </Field>

      <Field
        id={altId}
        label="Texto alternativo"
        error={errors.alt_text}
        hint="Descreva o que a imagem mostra, para quem usa leitor de tela e para buscadores."
        aside={
          <span className="text-caption text-muted tabular-nums">
            {alt.length}/{ALT_MAX}
          </span>
        }
      >
        <Textarea
          {...fieldAria(altId, errors.alt_text, true)}
          value={alt}
          maxLength={ALT_MAX}
          className="min-h-24"
          onChange={(event) => {
            setAlt(event.target.value);
          }}
        />
      </Field>
      {alt.trim() === '' && (
        <Notice tone="info">
          Sem texto alternativo, a imagem fica invisível para quem navega com leitor de tela.
        </Notice>
      )}

      <div>
        <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending}>
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}

/** Apagar, com confirmação; se o asset está em uso, mostra os projetos e pede confirmação explícita. */
function DeleteSection({
  asset,
  onDeleted,
}: {
  asset: MediaAssetDetailResponse;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [inUse, setInUse] = useState<MediaInUseProblem | null>(null);

  const remove = useMutation({
    mutationFn: (confirm: boolean) => deleteMedia(asset.id, confirm),
    onSuccess: (result) => {
      if (!result.deleted) {
        setInUse(result.inUse);
        return;
      }
      removeAsset(queryClient, asset.id);
      toast(`"${asset.filename}" foi apagado.`, 'success');
      onDeleted();
    },
    onError: (error) => {
      toast(error instanceof ApiError ? error.message : 'Não foi possível apagar.', 'danger');
    },
  });

  if (!confirming) {
    return (
      <div className="border-t border-border pt-6">
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setConfirming(true);
          }}
        >
          <TrashIcon aria-hidden />
          Apagar arquivo
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-6" role="alertdialog" aria-label="Confirmar exclusão">
      {inUse ? (
        <>
          <p className="text-support">
            Este arquivo está em uso em{' '}
            {inUse.projects.length === 1
              ? 'um projeto'
              : `${String(inUse.projects.length)} projetos`}
            . Se apagar, ele some destes projetos:
          </p>
          <ul className="mt-2 list-disc pl-5 text-support text-text-secondary">
            {inUse.projects.map((project) => (
              <li key={project.id}>{project.title}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-support">
          Apagar “{asset.filename}”? O arquivo sai da sua biblioteca e não pode ser recuperado por
          aqui.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="danger"
          size="sm"
          loading={remove.isPending}
          onClick={() => {
            remove.mutate(inUse !== null);
          }}
        >
          {inUse ? 'Apagar mesmo assim' : 'Sim, apagar'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setConfirming(false);
            setInUse(null);
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
