import { MediaLibrary } from '@/components/media/media-library';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Biblioteca de mídia — Casebook' };

export default function MediaPage() {
  return <MediaLibrary />;
}
