import { pictureSources } from '@/lib/media/format';
import { cn } from '@/lib/utils';
import { type MediaAssetResponse } from '@casebook/contracts/media';

interface MediaPictureProps {
  asset: Pick<MediaAssetResponse, 'sources' | 'palette' | 'alt_text' | 'width' | 'height'>;
  /** Largura ocupada na tela, para o browser escolher o derivativo (`sizes`). */
  sizes: string;
  /** `cover` preenche a caixa (grid); `contain` mostra a imagem inteira (detalhes). */
  fit?: 'cover' | 'contain';
  /** Texto alternativo; vazio quando a imagem é decorativa no contexto (o nome está ao lado). */
  alt?: string;
  eager?: boolean;
  className?: string;
}

/**
 * Imagem da biblioteca: `<picture>` AVIF → WebP → JPEG com as larguras que o
 * worker gerou de fato. Enquanto carrega, o fundo é a cor dominante da paleta.
 */
export function MediaPicture({
  asset,
  sizes,
  fit = 'cover',
  alt,
  eager,
  className,
}: MediaPictureProps) {
  const { formats, fallback } = pictureSources(asset.sources);
  if (!fallback) return null;
  return (
    <picture>
      {formats.map((format) => (
        <source key={format.type} type={format.type} srcSet={format.srcSet} sizes={sizes} />
      ))}
      <img
        src={fallback.url}
        alt={alt ?? asset.alt_text ?? ''}
        width={asset.width ?? undefined}
        height={asset.height ?? undefined}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        style={{ backgroundColor: asset.palette?.dominant }}
        className={cn('size-full', fit === 'cover' ? 'object-cover' : 'object-contain', className)}
      />
    </picture>
  );
}
