'use client';

import {
  ArrowSquareOutIcon,
  GearSixIcon,
  ImagesIcon,
  PlusIcon,
  SignOutIcon,
  SquaresFourIcon,
  TrashIcon,
  UserCircleIcon,
} from '@phosphor-icons/react/ssr';
import { type ReactNode, useState } from 'react';

import { ThemeToggle } from '@/components/settings/theme-toggle';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, fieldAria, FieldError } from '@/components/ui/field';
import { Input, PasswordInput, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { BottomNav, type NavItem, SideNav } from '@/components/ui/side-nav';
import { Skeleton } from '@/components/ui/skeleton';
import { Steps } from '@/components/ui/steps';
import { Switch } from '@/components/ui/switch';
import { TabsNav } from '@/components/ui/tabs';
import { Tag } from '@/components/ui/tag';
import { toast } from '@/components/ui/toast';

// Estados que só existem com interação, reproduzidos com as mesmas classes que o
// componente aplica — para aparecerem lado a lado, parados.
const FOCUS = 'outline-2 outline-offset-2 outline-accent-text';
const INPUT_FOCUS = 'border-accent-text shadow-[0_0_0_3px_var(--color-focus-ring)]';

const COLORS = [
  ['bg', 'bg-bg'],
  ['well', 'bg-well'],
  ['surface', 'bg-surface'],
  ['raised', 'bg-raised'],
  ['track', 'bg-track'],
  ['border-control', 'bg-border-control'],
  ['text', 'bg-text'],
  ['text-secondary', 'bg-text-secondary'],
  ['muted', 'bg-muted'],
  ['subtle', 'bg-subtle'],
  ['accent', 'bg-accent'],
  ['accent-hover', 'bg-accent-hover'],
  ['accent-text', 'bg-accent-text'],
  ['accent-tint', 'bg-accent-tint'],
  ['danger', 'bg-danger'],
  ['danger-tint', 'bg-danger-tint'],
  ['content-bg', 'bg-content-bg'],
  ['content-accent', 'bg-content-accent'],
  ['content-accent-text', 'bg-content-accent-text'],
] as const;

const BUTTON_VARIANTS = [
  ['primary', 'bg-accent-hover'],
  ['outline', 'bg-accent-tint'],
  ['secondary', 'bg-surface'],
  ['ghost', 'bg-surface text-text'],
  ['danger', 'border-danger'],
] as const;

const NAV: NavItem[] = [
  { href: '#projetos', label: 'Projetos', icon: SquaresFourIcon },
  { href: '#midia', label: 'Biblioteca de mídia', icon: ImagesIcon },
  { href: '#perfil', label: 'Perfil público', icon: UserCircleIcon, external: true },
  { href: '#config', label: 'Configurações', icon: GearSixIcon },
];

const CITIES = [
  { value: 'America/Sao_Paulo', label: 'America/Sao Paulo', detail: 'GMT-3' },
  { value: 'America/Manaus', label: 'America/Manaus', detail: 'GMT-4' },
  { value: 'Europe/Lisbon', label: 'Europe/Lisbon', detail: 'GMT+1' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo', detail: 'GMT+9' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = title.toLowerCase().replaceAll(/[^a-z]+/g, '-');
  return (
    <section aria-labelledby={id} className="flex flex-col gap-6 border-t border-border pt-8">
      <h2 id={id} className="text-section">
        {title}
      </h2>
      {children}
    </section>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="text-caption text-muted">{label}</span>
      {children}
    </div>
  );
}

export function Gallery() {
  const [checked, setChecked] = useState(true);
  const [city, setCity] = useState('America/Sao_Paulo');
  const [tags, setTags] = useState(['Cor', 'Finalização']);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Só em desenvolvimento</p>
          <h1 className="mt-2 text-page">Componentes</h1>
          <p className="mt-2 max-w-prose text-text-secondary">
            Os componentes base de <code>components/ui</code>, em todos os estados, nos tokens de{' '}
            <code>docs/design/README.md</code>.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Section title="Cores">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {COLORS.map(([name, className]) => (
            <li key={name} className="flex flex-col gap-1.5">
              <span className={`h-14 rounded-md border border-border ${className}`} />
              <span className="text-caption text-muted">{name}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Tipografia">
        <div className="flex flex-col gap-4">
          <p className="text-screen font-semibold">Título de tela, 44</p>
          <p className="text-page font-semibold">Título de página, 38</p>
          <p className="text-section font-semibold">Título de seção, 30</p>
          <p className="text-card">Título de card, 19</p>
          <p className="text-body">Corpo, 16. A cor que você trabalhou é a cor que o cliente vê.</p>
          <p className="text-support text-text-secondary">Texto de apoio, 14.</p>
          <p className="text-caption text-subtle">Legenda, 12.</p>
          <p className="label-caps">Rótulo de campo</p>
          <p className="eyebrow">Eyebrow</p>
          <p className="brand-mark">Casebook</p>
        </div>
      </Section>

      <Section title="Botão">
        <div className="grid gap-x-6 gap-y-8 sm:grid-cols-5">
          {BUTTON_VARIANTS.map(([variant, hover]) => (
            <div key={variant} className="flex flex-col gap-4">
              <State label={variant}>
                <Button variant={variant}>Salvar</Button>
              </State>
              <State label="hover">
                <Button variant={variant} className={hover}>
                  Salvar
                </Button>
              </State>
              <State label="focus-visible">
                <Button variant={variant} className={FOCUS}>
                  Salvar
                </Button>
              </State>
              <State label="disabled">
                <Button variant={variant} disabled>
                  Salvar
                </Button>
              </State>
              <State label="loading">
                <Button variant={variant} loading>
                  Salvando…
                </Button>
              </State>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <State label="sm">
            <Button size="sm">Salvar</Button>
          </State>
          <State label="md">
            <Button size="md">Salvar</Button>
          </State>
          <State label="lg">
            <Button size="lg">
              <PlusIcon aria-hidden /> Novo projeto
            </Button>
          </State>
          <State label="icon">
            <Button size="icon" variant="ghost" aria-label="Remover">
              <TrashIcon aria-hidden weight="duotone" />
            </Button>
          </State>
          <State label="link">
            <Button variant="link" size="inline">
              Ver todos
            </Button>
          </State>
        </div>
      </Section>

      <Section title="Campos">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="ui-default" label="Padrão" hint="Uma dica curta sobre o campo.">
            <Input {...fieldAria('ui-default', undefined, true)} placeholder="Placeholder" />
          </Field>
          <Field id="ui-filled" label="Preenchido">
            <Input id="ui-filled" defaultValue="Marina Duarte" />
          </Field>
          <Field id="ui-focus" label="Focus-visible">
            <Input id="ui-focus" defaultValue="marina@duarte.co" className={INPUT_FOCUS} />
          </Field>
          <Field id="ui-error" label="Erro" error="Este email já está em uso.">
            <Input {...fieldAria('ui-error', 'erro')} defaultValue="marina@duarte.co" />
          </Field>
          <Field id="ui-disabled" label="Disabled">
            <Input id="ui-disabled" disabled defaultValue="Não editável" />
          </Field>
          <Field id="ui-password" label="Senha">
            <PasswordInput id="ui-password" defaultValue="uma-frase-longa" />
          </Field>
          <Field
            id="ui-textarea"
            label="Textarea"
            aside={<span className="text-caption text-muted">44/500</span>}
          >
            <Textarea id="ui-textarea" defaultValue="Colorista com base em SP. Comerciais e doc." />
          </Field>
          <Field
            id="ui-textarea-error"
            label="Textarea com erro"
            error="A bio pode ter no máximo 500 caracteres"
          >
            <Textarea {...fieldAria('ui-textarea-error', 'erro')} defaultValue="…" />
          </Field>
          <Field id="ui-combobox" label="Select com busca">
            <Combobox
              id="ui-combobox"
              options={CITIES}
              value={city}
              onChange={setCity}
              emptyLabel="Sem fuso definido"
              placeholder="Busque por cidade"
            />
          </Field>
          <div className="flex flex-col gap-3">
            <Label htmlFor="ui-default">Label avulso</Label>
            <FieldError>Mensagem de erro de campo, avulsa.</FieldError>
          </div>
        </div>
      </Section>

      <Section title="Switch, tags e passos">
        <div className="flex flex-wrap items-center gap-8">
          <State label="ligado / desligado">
            <Switch checked={checked} onCheckedChange={setChecked} aria-label="Exemplo" />
          </State>
          <State label="desligado">
            <Switch checked={false} onCheckedChange={() => undefined} aria-label="Desligado" />
          </State>
          <State label="disabled">
            <Switch checked onCheckedChange={() => undefined} disabled aria-label="Desabilitado" />
          </State>
          <State label="tags">
            <div className="flex gap-2">
              {tags.map((tag) => (
                <Tag
                  key={tag}
                  removeLabel={`Remover ${tag}`}
                  onRemove={() => {
                    setTags(tags.filter((other) => other !== tag));
                  }}
                >
                  {tag}
                </Tag>
              ))}
              <Tag>Sem remover</Tag>
            </div>
          </State>
          <State label="passos">
            <Steps current={2} total={3} label="papel na produção" />
          </State>
          <State label="avatar">
            <Avatar name="Marina" />
          </State>
        </div>
      </Section>

      <Section title="Card e avisos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardTitle>Disponível para freelance</CardTitle>
            <CardDescription>Mostra um selo no seu perfil público</CardDescription>
          </Card>
          <Notice tone="info">Nada mudou desde o último salvamento.</Notice>
          <Notice tone="success">Perfil salvo.</Notice>
          <Notice tone="danger">Email ou senha inválidos</Notice>
        </div>
      </Section>

      <Section title="Menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" className="w-fit">
              Abrir menu
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>marina@duarte.co</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <ArrowSquareOutIcon aria-hidden weight="duotone" /> Ver perfil público
            </DropdownMenuItem>
            <DropdownMenuItem>
              <GearSixIcon aria-hidden weight="duotone" /> Configurações
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <ImagesIcon aria-hidden weight="duotone" /> Item desabilitado
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <SignOutIcon aria-hidden weight="duotone" /> Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Section>

      <Section title="Navegação">
        <div className="grid gap-8 sm:grid-cols-[14.75rem_1fr]">
          <SideNav label="Exemplo lateral" items={NAV} current="#projetos" />
          <div className="flex flex-col gap-8">
            <TabsNav
              label="Exemplo de abas"
              current="#perfil-tab"
              tabs={[
                { href: '#perfil-tab', label: 'Perfil' },
                { href: '#conta-tab', label: 'Conta' },
              ]}
            />
            <BottomNav
              label="Exemplo inferior"
              items={NAV}
              current="#projetos"
              className="max-w-[24.375rem] border-t border-border px-6 py-2"
            />
          </div>
        </div>
      </Section>

      <Section title="Toast">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              toast('Endereço copiado.');
            }}
          >
            Aviso
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              toast('Perfil salvo.', 'success');
            }}
          >
            Sucesso
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              toast('Não foi possível sair. Tente de novo.', 'danger');
            }}
          >
            Erro
          </Button>
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="flex max-w-md flex-col gap-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12" />
          <Skeleton className="h-28" />
        </div>
      </Section>

      <Section title="Estado vazio">
        <div className="flex rounded-md border border-border">
          <EmptyState
            title="Nenhum projeto ainda"
            action={
              <Button size="lg">
                <PlusIcon aria-hidden /> Novo projeto
              </Button>
            }
          >
            Cada projeto é uma página do seu portfólio, montada em blocos de imagem, vídeo e texto.
          </EmptyState>
        </div>
      </Section>
    </main>
  );
}
