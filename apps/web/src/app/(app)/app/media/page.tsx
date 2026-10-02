import { PageHeader } from '@/components/app/page-header';
import { EmptyState } from '@/components/ui/empty-state';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Biblioteca de mídia — Casebook' };

export default function MediaPage() {
  return (
    <>
      <PageHeader eyebrow="Seus arquivos" title="Biblioteca de mídia" />
      <EmptyState title="Sua biblioteca está vazia">
        Aqui vão ficar as imagens e os vídeos que você enviar, já convertidos para a web. O envio de
        arquivos chega na próxima versão.
      </EmptyState>
    </>
  );
}
