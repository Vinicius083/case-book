'use client';

import { CloudArrowUpIcon } from '@phosphor-icons/react/ssr';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { ACCEPTED_IMAGE_FORMATS_LABEL, ACCEPTED_MIME_TYPES } from '@casebook/contracts/media';

/** O que o seletor de arquivos oferece; a validação de verdade é a dos contratos. */
export const ACCEPT = [
  ...ACCEPTED_MIME_TYPES.image,
  '.heic',
  '.heif',
  '.avif',
  '.tif',
  '.tiff',
].join(',');

interface MediaDropzoneProps {
  onFiles: (files: File[]) => void;
  /** Uma linha, para quando já há itens na tela. */
  compact?: boolean;
  className?: string;
}

/**
 * Área de soltar arquivos do painel de mídia (design 2.2): borda tracejada,
 * ícone de nuvem, título e os formatos aceitos. Também abre o seletor ao clicar.
 */
export function MediaDropzone({ onFiles, compact = false, className }: MediaDropzoneProps) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={inputId}
      data-dropzone
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles([...event.dataTransfer.files]);
      }}
      className={cn(
        'flex cursor-pointer items-center gap-4 rounded-md border border-dashed border-border-control text-center transition-colors hover:border-accent-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-text',
        compact ? 'px-5 py-4 text-left' : 'flex-col px-6 py-12',
        over && 'border-accent-text bg-accent-tint',
        className,
      )}
    >
      <CloudArrowUpIcon
        aria-hidden
        weight="duotone"
        className={cn('shrink-0 text-accent-text', compact ? 'size-7' : 'size-10')}
      />
      <span>
        <span className={cn('block', compact ? 'text-support' : 'text-card')}>
          Arraste arquivos ou <span className="link">escolha do computador</span>
        </span>
        <span className="mt-1 block text-caption text-muted">
          {ACCEPTED_IMAGE_FORMATS_LABEL} · até 50 MB por imagem
        </span>
      </span>
      <FileInput id={inputId} onFiles={onFiles} />
    </label>
  );
}

/** `<input type="file">` invisível, múltiplo; limpa o valor para aceitar o mesmo arquivo de novo. */
export function FileInput({ id, onFiles }: { id: string; onFiles: (files: File[]) => void }) {
  return (
    <input
      id={id}
      type="file"
      multiple
      accept={ACCEPT}
      className="sr-only"
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = '';
        if (files.length > 0) onFiles(files);
      }}
    />
  );
}

/**
 * Soltar arquivos em qualquer ponto da página: cobre a tela com um aviso
 * enquanto o usuário arrasta. Só reage a arrasto de arquivos, não de texto.
 */
export function PageDropOverlay({
  onFiles,
  children,
}: {
  onFiles: (files: File[]) => void;
  children?: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  // `dragenter`/`dragleave` disparam a cada elemento filho: conta a profundidade.
  const depth = useRef(0);
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current++;
      setDragging(true);
    };
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      // Soltou em cima de uma `MediaDropzone`: ela mesma já tratou os arquivos.
      if ((event.target as Element | null)?.closest('[data-dropzone]')) return;
      handler.current([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!dragging) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-bg/80 p-6"
    >
      <div className="flex w-full max-w-xl flex-col items-center gap-3 rounded-md border-2 border-dashed border-accent-text bg-surface px-8 py-14 text-center">
        <CloudArrowUpIcon weight="duotone" className="size-12 text-accent-text" />
        <p className="text-card">Solte para enviar</p>
        {children}
      </div>
    </div>
  );
}
