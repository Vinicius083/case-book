import { Images } from 'lucide-react';

import { EmptyState } from '@/components/app/empty-state';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Biblioteca de mídia — Casebook' };

export default function MediaPage() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-heading text-3xl font-bold">Biblioteca de mídia</h1>
      <EmptyState icon={Images} title="Sua biblioteca está vazia">
        Aqui vão ficar as imagens e os vídeos que você enviar, já convertidos para a web. O envio de
        arquivos chega na próxima versão.
      </EmptyState>
    </div>
  );
}
