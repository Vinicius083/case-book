import { notFound } from 'next/navigation';

import { Gallery } from './gallery';

import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Componentes — Casebook', robots: { index: false } };

// Catálogo dos componentes base em todos os estados. Só existe em desenvolvimento;
// num build de produção, só com DEV_UI=1 (o E2E usa para as capturas de tela).
export default function UiPage() {
  if (process.env.NODE_ENV === 'production' && process.env['DEV_UI'] !== '1') notFound();
  return <Gallery />;
}
