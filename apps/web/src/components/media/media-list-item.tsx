import { formatFacts } from '@/lib/media/format';
import { type MediaAssetResponse } from '@casebook/contracts/media';

import { MediaPicture } from './media-picture';

/**
 * Item de mídia em lista (design 2.2): miniatura 46×32, nome com reticências e
 * "L×A · MB". Usado no seletor de foto de perfil e, na Sprint 3, no painel de
 * mídia do builder.
 */
export function MediaListItem({ asset }: { asset: MediaAssetResponse }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="bg-placeholder block h-8 w-[2.875rem] shrink-0 overflow-hidden rounded-sm">
        <MediaPicture asset={asset} sizes="46px" alt="" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-support" title={asset.filename}>
          {asset.filename}
        </span>
        <span className="block text-caption text-muted">{formatFacts(asset)}</span>
      </span>
    </span>
  );
}
