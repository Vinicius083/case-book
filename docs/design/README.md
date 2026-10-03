# Design do Casebook

Inventário do export do Claude Design versionado em [`source/`](source/): o que o design define, o
que falta nele e onde ele conflita com o que está implementado ou com
[`docs/requisitos.md`](../requisitos.md). As seções 1 a 6 são o inventário original (2026-10-02),
mantido como registro; as [decisões](#7-decisões), [o que foi implementado](#8-implementado) e o
[alinhamento da Sprint 2](#9-sprint-2--alinhamento-da-mídia-com-o-design) vêm depois e valem
sobre ele.

**Estado:** divergências decididas em 2026-10-02; tokens, componentes base e retrofit das telas da
Sprint 1 aplicados. Capturas em [`screenshots/`](screenshots/) (`design/` = recortes do export,
`app/` = telas implementadas em 1440 e 390).

## 1. O que há no export

| Arquivo | Conteúdo |
| --- | --- |
| `source/Fluxo 1 - Cadastro e Perfil.dc.html` | 8 telas: boas-vindas, cadastro, papel na produção, criação de perfil, dashboard vazio e 3 mobile |
| `source/Fluxo 2 - Builder e Publicação.dc.html` | 9 telas: dashboard, builder, preview fiel, diálogo de publicação, página pública do projeto, configurações e 2 mobile |
| `source/Fluxo 3 - Descoberta e Perfil Público.dc.html` | 6 telas: descoberta, busca vazia, perfil público, case aberto e 2 mobile |
| `source/_ds/broadsheet-…/styles.css` | Design system "Broadsheet": tokens e classes de componente |
| `source/_ds/broadsheet-…/readme.md` | Guia de uso do Broadsheet |
| `source/_ds/broadsheet-…/_ds_bundle.js` | Filtros SVG do tratamento de imagem em "chapas CMYK" (`print-plates.js`) |
| `source/_ds/broadsheet-…/_ds_manifest.json`, `_adherence.oxlintrc.json` | Lista de tokens e regras de lint (sem hex, sem px, só Source Serif 4) |
| `source/support.js`, `source/.thumbnail` | Runtime do visualizador de canvas e miniatura; não são design |

O manifesto cita páginas de `foundations/`, `components/` e `templates/` do Broadsheet que **não
vieram no export**. O que se sabe dos componentes do design system vem de `styles.css` e do
`readme.md`.

### As telas não usam o Broadsheet como ele se descreve

Este é o ponto central do inventário. O Broadsheet é um sistema **claro** ("papel de jornal",
fundo `#f3f2f2`, "this system shows no dark surfaces", sem caixas nem divisores). Os três fluxos
carregam o `styles.css` dele e sobrescrevem quatro tokens para uma interface **escura**:

```css
:root {
  --color-bg: #0e0d0d;
  --color-surface: #171616;
  --color-text: #f3f2f2;
  --color-divider: rgba(243, 242, 242, 0.13);
}
```

O resto vem do Broadsheet: as rampas de cor, a fonte, os raios. Os fluxos são 100% estilo inline e
**não usam nenhuma classe de componente** do Broadsheet (`.btn`, `.input`, `.card`…). Tratei os
fluxos como a fonte de verdade das telas e o Broadsheet como a fonte das rampas e da tipografia —
ver a [divergência D1](#51-dentro-do-próprio-design).

## 2. Tokens

### 2.1 Cor

Valores como aparecem nos fluxos (tema escuro). Os nomes semânticos são a proposta para o
`@theme`; a coluna "origem" diz de onde o valor vem.

| Papel | Token proposto | Valor | Origem |
| --- | --- | --- | --- |
| Fundo do app | `--color-bg` | `#0e0d0d` | override dos fluxos |
| Fundo de poço (canvas do builder, área de preview) | `--color-well` | `#080808` / `#0a0a0a` | hex solto nas telas 1.4, 2.2, 2.3 |
| Superfície (input, card, item ativo da navegação) | `--color-surface` | `#171616` | override dos fluxos |
| Texto | `--color-text` | `#f3f2f2` | override dos fluxos |
| Texto secundário (parágrafos de apoio) | `--color-text-secondary` | `#bab6b6` | `neutral-400` |
| Texto atenuado (rótulos, metadados) | `--color-muted` | `#9b9797` | `neutral-500` |
| Texto mínimo (legendas de 11–12px, notas) | `--color-subtle` | `#7d7979` | `neutral-600` |
| Borda e divisor | `--color-border` | `rgba(243,242,242,.13)` | override dos fluxos |
| Borda tracejada (áreas vazias, "adicionar") | `--color-border-dashed` | `#605d5d` | `neutral-700` |
| Trilho (barra de progresso, toggle desligado) | `--color-track` | `#444141` / `#605d5d` | `neutral-800` / `neutral-700` |
| Accent: preenchimento de ação primária | `--color-accent` | `#0088b0` | Broadsheet |
| Texto sobre o accent | `--color-on-accent` | `#050505` | hex solto, em todo botão primário |
| Accent hover / pressionado | `--color-accent-hover` / `-active` | `#1186ac` / `#006786` | `accent-600` / `accent-700` |
| Accent como texto, ícone ativo, borda de foco | `--color-accent-text` | `#99e0ff` | `accent-300` |
| Accent em hover de link | — | `#cbeeff` | `accent-200` |
| Tinta de accent (chip, item selecionado) | `--color-accent-tint` | `rgba(0,136,176,.14)` (texto `#cbeeff`) | hex solto |
| Anel de foco do input | `--shadow-focus` | `0 0 0 3px rgba(0,136,176,.16)` | tela 1.2 |
| Segundo accent (numeração das seções, aviso, perigo) | `--color-accent-2` | `#d6006c` | Broadsheet |
| Aviso / perigo: texto e tinta | `--color-danger` | texto `#ffdee6` sobre `rgba(214,0,108,.10)`, borda `#aa0b56` | telas 2.4 e 2.6 |
| Amarelo de processo | — | `#edbb00` | só para o tratamento CMYK |

Rampas completas (`neutral`, `accent`, `accent-2`, de 100 a 900) estão em `styles.css` e entram
como estão.

**Não existe no design:** cor de erro de formulário, cor de sucesso, estado de erro de input.
O magenta (`accent-2`) aparece como aviso (2.4) e como perigo (2.6, "Excluir conta"); hoje o front
usa `--color-danger: #ff5c5c`, que não pertence ao design. Ver [P9](#52-de-produto).

**Cor de conteúdo × cor de UI.** As páginas públicas (2.5, 3.3, 3.4) trocam o accent pelo primeiro
tom da paleta extraída da mídia (âmbar `#e0743c`, azul `#6fb2d6`, violeta `#a883d6`) e o fundo por
um quase-preto tingido (`#0d0b0a`, `#0b0c0e`, `#0c0a0e`). O design confirma a separação pedida:
um conjunto `--content-*` (bg, accent, accent-text, accent-tint, on-accent) para o renderer
público, independente dos tokens de UI do app.

### 2.2 Tipografia

Uma família só: **Source Serif 4** (variável, eixos `opsz` 8–60 e `wght` 300–700, com itálico
verdadeiro). O guia é explícito: "Do not introduce a sans-serif for UI chrome; the serif is the
chrome". Peso de título 600; corpo 400. Fallback declarado: `system-ui, sans-serif`.

Escala usada nas telas (os fluxos não seguem a escala `h1`–`h6` do `styles.css`, que é 42/32/25/20/16/13):

| Uso | Tamanho | Peso | Line-height | Tracking |
| --- | --- | --- | --- | --- |
| Hero da landing | 76px (40px no mobile) | 600 | 1.02–1.05 | −0.03em |
| Título de case / nome no perfil público | 54–62px | 600 | 1.03–1.04 | −0.03em |
| Título de tela (cadastro, onboarding) | 44px (32–34px mobile) | 600 | 1.12 | −0.02em |
| Título de página do app | 38px (30px mobile) | 600 | 1.12 | −0.02em |
| Título de seção / diálogo / estado vazio | 30–32px | 600 | 1.12 | −0.02em |
| Título de card | 17–20px | 600 | 1.2 | — |
| Citação | 34px itálico | 600 | 1.24 | — |
| Corpo destacado | 18–19px | 400 | 1.62–1.65 | — |
| Corpo | 15–16px | 400 | 1.55–1.6 | — |
| Texto de apoio | 13–14px | 400 | 1.5–1.55 | — |
| Legenda / metadado | 11–12px | 400 | 1.5 | — |
| Eyebrow e rótulo de campo | 11–12px, **maiúsculas** | 400 | — | 0.12–0.22em |
| Marca "CASEBOOK" | 13–14px, maiúsculas | 600 | — | 0.3em |

### 2.3 Espaçamento, raios, sombras

- **Espaçamento (Broadsheet, densidade 1.25×):** `--space-1` 5px, `-2` 10px, `-3` 15px, `-4` 20px,
  `-6` 30px, `-8` 40px. Os fluxos **não usam** esses tokens; os valores recorrentes são 7, 8, 12,
  14, 16, 18, 22, 26, 40, 44 e 56px. Padding de input: 13×15px (12×14 em configurações). Padding de
  botão primário: 13–15px × 24–32px.
- **Raios:** `--radius-sm` 1px, `--radius-md` 2px (praticamente tudo), `--radius-lg` 4px. Fora da
  escala: círculo em avatares e botões de play, pílula nos toggles (12–13px), 14px na moldura de
  celular (só apresentação).
- **Sombras:** as `--shadow-sm/md/lg` do Broadsheet são para fundo claro e não aparecem nas telas.
  Nas telas: diálogo `0 30px 80px rgba(0,0,0,.7)`. A sombra `0 24px 60px rgba(0,0,0,.5)` é da
  moldura de apresentação das telas no canvas, não do produto.
- **Larguras fixas:** barra lateral 236px; painéis do builder 224px e 268px; filtros da descoberta
  250px; diálogo 560px; formulário de cadastro até 480px.

### 2.4 Breakpoints

O design não define breakpoints. Há dois tamanhos de quadro: **desktop 1360px** e **mobile
390×844**. O comportamento intermediário (tablet, barra lateral colapsando) não está desenhado.
No mobile a navegação vira uma **barra inferior de 4 ícones**.

### 2.5 Motion

- `cbPulse`: opacidade 0.35/0.4 ↔ 1, de 1.1s a 2s, em cursor de texto, spinner de transcodificação
  e indicador de showreel.
- `cbShimmer`: translação horizontal declarada no fluxo 2, **sem uso em nenhuma tela**.
- Tratamento CMYK (Broadsheet): as chapas entram em registro em 450ms, cubic-out, no hover; some
  com `prefers-reduced-motion` ou sem ponteiro fino.
- Nada sobre transição de hover, abertura de menu ou de diálogo.

### 2.6 Ícones e imagem

- **Ícones:** Phosphor, peso **duotone**, em toda a interface (18px na navegação, 15–20px em
  botões). Hoje o front usa `lucide-react`.
- **Imagem:** o Broadsheet prevê fotos como chapas CMYK fora de registro (`.cmyk`) ou retícula
  (`.halftone`). **As telas não usam nenhum dos dois**: mídia é gradiente escuro de placeholder com
  linhas de varredura.

## 3. Componentes

"Existente" = já há em `apps/web/src/components`, feito à mão no padrão shadcn (mantemos a
abordagem, sem a CLI).

| No design | Onde aparece | Equivalente | Situação |
| --- | --- | --- | --- |
| Botão primário (accent sólido, texto `#050505`) | todas | `ui/button` variante `primary` | existente, reestilizar |
| Botão contornado em accent ("Criar portfólio", "Publicar") | 1.1, 2.2, 3.1 | `ui/button` variante nova `outline-accent` | novo |
| Botão secundário (borda neutra) | 1.4, 1.5, 3.2 | `ui/button` variante `secondary` | existente, reestilizar |
| Ação em texto ("Voltar", "Cancelar", "Limpar") | 1.3, 2.4, 3.1 | `ui/button` variante `ghost` / link | existente, reestilizar |
| Botão de ícone | 2.2, 2.7b | `ui/button` tamanho `icon` | existente, reestilizar |
| Campo de texto com rótulo em maiúsculas | 1.2, 1.4, 2.4 | `ui/input` + `ui/field` + `ui/label` | existente, reestilizar |
| Campo com rótulo em caixa normal | 2.6 | idem | o design tem os dois estilos de rótulo |
| Textarea com contador | 1.4 | `ui/input` (Textarea) + contador do `Field` | existente |
| Mostrar/ocultar senha (ícone de olho) | 1.2 | — | não existe |
| Select (fuso) | 1.4 | — | não existe; depende de P5 |
| Toggle (switch) | 1.4, 2.4, 2.6 | `ui/switch` | novo; sem uso nas telas da Sprint 1 |
| Checkbox | 3.1, 3.2 | `ui/checkbox` | novo; Fase 2 |
| Chip removível / tag | 1.4, 2.4, 3.1 | `ui/tag` (e o `TagInput` de papéis) | existente, reestilizar |
| Selo de status (Publicado, Rascunho) | 2.1, 2.3 | `ui/badge` | novo; Sprint 3 |
| Card selecionável (papel na produção) | 1.3 | `ui/choice-card` | novo; depende de P3 |
| Card de projeto (thumb, status, duração) | 2.1, 2.7b | componente do app | novo; Sprint 3 |
| Card de profissional | 3.1, 3.5b | componente do app | Fase 2 |
| Barra lateral de navegação | 1.5, 2.1, 2.6 | `app/app-shell` | existente, reestilizar; itens divergem (P6) |
| Barra inferior mobile | 2.7b, 3.5b | `app/app-shell` | novo |
| Cabeçalho de página (eyebrow + título + ação) | 1.5, 2.1 | `app/page-header` | novo |
| Abas | 2.6 | `ui/tabs` | novo; depende de P7 |
| Controle segmentado (Editar/Preview, Desktop/Mobile) | 2.2, 2.3 | `ui/segmented` | novo; Sprint 3 |
| Estado vazio | 1.5, 3.2 | `app/empty-state` | existente, reestilizar (centralizado, com ilustração de 3 quadros) |
| Área tracejada ("adicionar", soltar arquivos) | 1.3, 1.4, 2.1, 2.2 | `ui/dropzone` | novo; Sprint 2 |
| Barra de progresso | 1.5, 2.1, 2.2 | `ui/progress` | novo; Sprint 2 |
| Indicador de passos ("1 de 3") | 1.2–1.4 | `ui/steps` | novo; depende de P1 |
| Diálogo modal | 2.4 | `ui/dialog` (Radix) | novo; Sprint 4 |
| Aviso inline (magenta) | 2.4 | `ui/notice` | existente, reestilizar |
| Caixa de perigo ("Excluir conta") | 2.6 | `ui/notice` tom `danger` | depende de P8 |
| Avatar (círculo com gradiente) | 1.4, 1.5, 3.3 | `ui/avatar` | novo |
| Busca | 3.1 | — | Fase 2 |
| Blocos do builder (6 tipos) | 2.2, 2.5 | `packages/renderer` | Sprint 3; divergem dos 9 dos requisitos (P10) |
| Paleta extraída (5 amostras) | 2.5, 3.4 | bloco do renderer | Sprint 4 |
| Lista de créditos | 2.5, 3.4 | bloco do renderer | não está nos requisitos (P10) |
| Player de vídeo (play circular, barra de dados) | 2.5, 3.3 | bloco do renderer | Sprints 6–7 |

**Pedidos na tarefa e ausentes do design:** menu/dropdown (o design mostra só o avatar e o nome,
sem menu), toast, skeleton, mensagem de erro de campo, estado de loading de botão, estado
disabled. Para esses eu derivo dos tokens e mostro na página `/ui` para você aprovar.

## 4. Telas

| # | Tela no design | Rota | Sprint | Situação |
| --- | --- | --- | --- | --- |
| 1.1 | Boas-vindas (landing) | `/` | — | hoje `/` é a página de status da API; landing não está no plano |
| 1.2 | Cadastro | `/signup` | 1 | **existe**; campos e fluxo divergem (P1, P2) |
| 1.3 | Papel na produção | — | — | não existe; passo de onboarding fora do plano (P3) |
| 1.4 | Criação de perfil com preview | `/app/settings/profile` | 1 | **existe** como configurações, sem preview nem passo de onboarding (P1, P4, P5) |
| 1.5 | Dashboard vazio | `/app` | 1 | **existe**; itens de navegação e ações divergem (P6) |
| 1.6a–c | Mobile: boas-vindas, cadastro, papel | idem | 1 | cadastro existe; os outros dois não |
| — | **Login** | `/login` | 1 | **existe e não está no design** (P11) |
| — | Biblioteca de mídia | `/app/media` | 2 | existe como estado vazio; **não está no design** (P6) |
| 2.1 | Dashboard com projetos | `/app` | 3 | futuro |
| 2.2 | Builder | `/app/projects/:id` | 3 | futuro |
| 2.3 | Preview fiel | `/app/projects/:id/preview` | 5 | futuro |
| 2.4 | Diálogo de publicação | no builder | 4 | futuro |
| 2.5 | Página pública do projeto | `/u/:handle/:slug` | 4 | futuro |
| 2.6 | Configurações de conta | `/app/settings/*` | 1 (parcial) | só "Perfil" existe; estrutura diverge (P7) |
| 2.7a | Mobile: projeto público | `/u/:handle/:slug` | 4 | futuro |
| 2.7b | Mobile: dashboard | `/app` | 3 | futuro |
| 3.1, 3.2, 3.5b | Descoberta e busca vazia | — | Fase 2 | fora do MVP |
| 3.3, 3.5a | Perfil público | `/u/:handle` | 4 | existe só o esboço; showreel é Fase 2 |
| 3.4 | Case aberto (acento violeta) | `/u/:handle/:slug` | 4 | futuro |

Das telas da Sprint 1 que a tarefa manda refazer, o design cobre **cadastro, dashboard vazio e
parte das configurações**. Login, troca de handle, troca de senha, menu da conta, estado de
carregamento da sessão e a biblioteca vazia não têm desenho.

## 5. Divergências

### 5.1 Dentro do próprio design

**D1 — Tema claro ou escuro.** O Broadsheet é claro e diz que não tem superfície escura; as telas
são escuras. *Minha leitura:* as telas mandam, o app é **só escuro**, e o Broadsheet entra como
fonte das rampas e da fonte. Confirma? A alternativa é implementar também o tema claro do
Broadsheet, que não tem nenhuma tela desenhada.

**D2 — "Sem caixas nem divisores" × telas cheias de bordas.** O guia proíbe estruturar a página
com bordas, cards e réguas; as telas usam borda em inputs, cards, barra lateral e cabeçalhos.
*Minha leitura:* sigo as telas.

**D3 — Rótulos em maiúsculas.** O cadastro (1.2) e o onboarding (1.4) usam rótulo de campo em
maiúsculas com tracking; as configurações (2.6) usam rótulo em caixa normal. Preciso de um só
padrão para o `Field`. *Sugestão:* maiúsculas, que é o que aparece nas telas de entrada.

**D4 — Valores fora dos tokens.** `#050505`, `#080808`, `#0a0a0a`, as tintas `rgba(0,136,176,…)` e
todos os paddings estão soltos nas telas, contra as regras de lint do próprio design system.
Viram tokens nomeados (seção 2.1); não muda nada visualmente.

**D5 — Tratamento de imagem.** O Broadsheet define chapas CMYK e retícula para fotos; nenhuma tela
usa. *Minha leitura:* não se aplica ao produto (a promessa é fidelidade de cor da mídia do
usuário). Não implemento.

### 5.2 De produto

Não resolvi nenhuma. Em cada uma, o que o design mostra, o que existe hoje e o que preciso saber.

**P1 — Cadastro em 3 passos.** Design: conta → papel → perfil, com "1 de 3". Hoje: um formulário
só, que cai no app. Mudar para wizard muda comportamento e rotas, o que a tarefa proíbe.
*Pergunta:* mantenho um passo só e aplico apenas o visual da tela 1.2?

**P2 — Campos do cadastro.** Design: Nome, E-mail, Senha. Hoje: nome de exibição, email, senha e
**handle**, com checagem de disponibilidade e preview do endereço (RF-AUTH-3 exige handle no
cadastro). O design não tem campo de handle em lugar nenhum do fluxo 1; o endereço aparece pronto
como `casebook.co/marinaduarte`. *Pergunta:* mantenho o campo de handle no cadastro, no visual
novo?

**P3 — Login social.** Design: botões Google, Apple e Vimeo, e "Importar do Vimeo" no dashboard.
Não está nos requisitos; a auth foi feita à mão de propósito. *Pergunta:* fica fora (não desenho
os botões) ou entra no plano?

**P4 — Senha mínima.** Design: "mínimo 8 caracteres". Implementado e testado: 10 a 128. Mantenho
10 e troco só o texto do placeholder, salvo ordem em contrário.

**P5 — Campos de perfil que não existem.** Design: "Fuso de trabalho", "Disponível para freelance"
(com selo no perfil público), bio de **160** caracteres. Schema: sem fuso, sem disponibilidade,
bio de 500. Também faltam no design campos que existem: **links externos** e handle.
*Pergunta:* crio os dois campos (migration) ou ficam fora? Bio continua 500?

**P6 — Navegação do app.** Design: Projetos, Perfil público, Visualizações, Configurações, mais um
cartão de armazenamento ("0,4 de 20 GB · plano Autor"). Hoje: Projetos, Biblioteca de mídia,
Perfil. "Visualizações" é analytics (fora do MVP), cota e planos não existem nos requisitos, e a
**biblioteca de mídia (RF-LIB, MVP) não aparece no design**. *Pergunta:* qual é a lista de itens?
Minha sugestão: Projetos, Biblioteca de mídia, Perfil público, Configurações, sem armazenamento.

**P7 — Estrutura das configurações.** Design: abas Perfil, Privacidade, Projetos, Domínio, Plano,
com toggles de privacidade e lista de projetos publicados. Hoje: uma página com três seções
(perfil, handle, senha). Domínio customizado e plano estão fora do MVP. O design **não tem** troca
de handle nem de senha. *Pergunta:* mantenho as três seções atuais dentro de uma aba "Perfil" (ou
sem abas), no visual novo?

**P8 — Excluir conta.** Design: caixa "Excluir conta" com prazo de 30 dias. Não há endpoint nem
tela. *Pergunta:* fica para outra sprint?

**P9 — Cor de erro.** O design não tem vermelho; usa magenta para aviso e perigo. Erro de campo e
`Notice` de erro hoje são `#ff5c5c`. *Sugestão:* erro passa a usar o magenta do design
(`accent-2-300` para texto, que dá 12,7:1 sobre o fundo). Confirma?

**P10 — Blocos do builder.** Design: 6 tipos (vídeo em tela cheia, grid, antes/depois, carrossel,
texto, créditos). Requisitos: 9 tipos (`cover`, `text`, `image`, `gallery_grid`, `fullbleed`,
`split`, `carousel`, `video`, `spacer`). "Antes/depois" e "Créditos" não existem nos requisitos;
`cover`, `image`, `split` e `spacer` não existem no design. Não afeta esta tarefa; precisa de
decisão antes da Sprint 3.

**P11 — Login sem desenho.** *Proposta:* mesma composição da tela 1.2 (painel de citação à
esquerda, formulário à direita), com email e senha. Confirma?

**P12 — Domínio e formato do endereço.** Design: `casebook.co/marinaduarte` e
`casebook.co/marinaduarte/natura-essencia`. Implementado e nos requisitos: `casebook.app/u/:handle`
e `/u/:handle/:slug`. *Pergunta:* qual vale? Tirar o `/u/` é mudança de rota e de regra de handle
reservado.

**P13 — Promessas técnicas no texto das telas.** A landing e o builder falam em ProRes, H.265/HEVC,
4K/6.2K, Rec.709/P3, DNG/TIFF e download do master por link privado. Os requisitos preveem H.264
em HLS até 1440p, conversão para sRGB e os formatos JPEG/PNG/HEIC/TIFF/WebP/AVIF. Não afeta esta
tarefa (a landing não está no escopo), mas o texto não pode ir ao ar como está.

**P14 — Fora do MVP presentes no design.** Descoberta e busca (fluxo 3), showreel automático,
"Contratar / Enviar briefing", contagem de visualizações, "Disponível". Tudo Fase 2 nos requisitos.
Só registro.

**P15 — Texto com gênero.** "Bem-vinda, Marina." *Sugestão:* manter o título atual da página
("Projetos"), sem saudação.

### 5.3 Efeitos colaterais técnicos, para ciência

- **Ícones:** trocar `lucide-react` por Phosphor duotone (`@phosphor-icons/react`).
- **Fonte:** sai o `@fontsource-variable/archivo`, entra Source Serif 4 por `next/font/google`
  (baixada no build e servida do próprio domínio). O build passa a precisar de acesso à internet.
- **Peça da Sprint 1 que sai:** o quadro 2.39:1 do cadastro (`ProfileFrame`) não existe no design;
  no lugar entra o painel de citação da tela 1.2. O preview do endereço continua em texto, junto
  ao campo de handle (se P2 for "manter").
- **Texto de marca:** "CASEBOOK" em maiúsculas com tracking de 0.3em.

## 6. Contraste (WCAG 2.1)

Medido sobre os valores do tema escuro. AA pede 4,5:1 para texto normal e 3:1 para texto grande e
elementos de interface.

| Par | Razão | Resultado |
| --- | --- | --- |
| Texto `#f3f2f2` sobre fundo `#0e0d0d` | 17,4:1 | passa |
| Texto sobre superfície `#171616` | 16,2:1 | passa |
| `neutral-400` (texto secundário) sobre fundo | 9,7:1 | passa |
| `neutral-500` (rótulos) sobre fundo / superfície | 6,7:1 / 6,3:1 | passa |
| `neutral-600` (legendas de 11–12px) sobre fundo | 4,51:1 | passa no limite |
| `neutral-600` sobre superfície | 4,2:1 | **falha** para texto pequeno |
| `#050505` sobre accent `#0088b0` (rótulo do botão) | 5,0:1 | passa |
| `#050505` sobre accent hover `#1186ac` | 4,9:1 | passa |
| Accent `#0088b0` sobre fundo (borda, preenchimento) | 4,8:1 | passa |
| `accent-300` (links, foco) sobre fundo | 13,4:1 | passa |
| `accent-200` sobre tinta de accent (chips) | 14,0:1 | passa |
| `accent-2-200` sobre tinta magenta (aviso) | 13,8:1 | passa |
| Borda de input (13% de branco) sobre fundo / superfície | 1,4:1 | **falha** os 3:1 de componente de interface |
| Borda tracejada `neutral-700` sobre fundo | 2,98:1 | **falha** por pouco |

Três pares falham, e não alterei nenhuma cor:

1. **`neutral-600` sobre superfície** (4,2:1): aparece em notas pequenas dentro de cards e no
   placeholder "mínimo 8 caracteres". Subir para `neutral-500` resolve.
2. **Borda de input** (1,4:1): o campo se distingue do fundo quase só pelo preenchimento
   `#171616` sobre `#0e0d0d`, que também tem contraste baixo (1,1:1). É o critério 1.4.11.
   Resolver exige borda perto de 45% de branco, o que muda bastante a cara das telas.
3. **Borda tracejada** (2,98:1): `neutral-600` resolve.

*Pergunta:* aceito os três como estão no design, ou aplico as correções sugeridas?

## 7. Decisões

Registradas em **2026-10-02**. "Dono" diz quem decidiu: **produto** = resposta do Vinícius às
perguntas da seção 5; **implementação** = leitura minha nas divergências que não travavam,
marcadas **decidido por mim, revisar**.

| # | Decisão | Dono |
| --- | --- | --- |
| D1 | **Tema claro e escuro, escuro como padrão.** Segue `prefers-color-scheme` até a pessoa escolher; a escolha fica em Configurações → Perfil → Aparência. O tema claro é **derivado, pendente de validação no Claude Design** (ver 8.1). | produto |
| D2 | Bordas, cards e divisores como nas telas, não como o guia do Broadsheet. | decidido por mim, revisar |
| D3 | Rótulo de campo em **maiúsculas com tracking** em todo lugar (padrão das telas de entrada), inclusive nas configurações, onde o design usa caixa normal. | decidido por mim, revisar |
| D4 | Hex e paddings soltos das telas viraram tokens nomeados. | decidido por mim, revisar |
| D5 | Tratamento de imagem CMYK/retícula do Broadsheet **não** foi implementado. | decidido por mim, revisar |
| P1 | **Cadastro em 3 passos.** Passo 1 (`/signup`) cria a conta; passos 2 e 3 (`/onboarding/role`, `/onboarding/profile`) são onboarding, com sessão, salvam por `PATCH /me/profile` e têm "Pular por agora". `profiles.onboarding_completed_at` nulo faz o app redirecionar ao passo pendente. | produto |
| P2 | Handle **fica no passo 1** (RF-AUTH-3), com checagem em tempo real e preview do endereço. | produto |
| P3 | Login social **fora por agora**; botões não desenhados. Registrado como planejado em [`tech-debt.md`](../tech-debt.md). | produto |
| P4 | Senha mínima continua **10** (o design diz 8). | decidido por mim, revisar |
| P5 | **Migration 0004:** `work_timezone` (IANA), `available_for_freelance`, `onboarding_completed_at`. Bio continua em **500**, com contador `n/500`. | produto |
| P6 | Navegação: **Projetos, Biblioteca de mídia, Perfil público, Configurações.** Reinspecionei as três visualizações da navegação (1.5, 2.1/2.6 e a barra mobile 2.7b): a biblioteca não aparece em nenhuma, então vale a lista de fallback. Sem "Visualizações" e sem cartão de armazenamento/plano (planejado). | produto |
| P7 | Configurações em **abas no visual do design**, uma rota por aba (`/app/settings/[tab]`): **Perfil** (dados + tema) e **Conta** (handle, senha, sair de todos os dispositivos). Privacidade, Projetos, Domínio e Plano não aparecem até existirem. | produto |
| P8 | "Excluir conta" fica para outra sprint; não há caixa de perigo na tela. | decidido por mim, revisar |
| P9 | Erro usa o **magenta do design** como `--color-danger`, com a luminosidade ajustada por tema (ver 8.2). | produto |
| P10 | Blocos do builder (6 no design × 9 nos requisitos): **não decidido aqui**; precisa de resposta antes da Sprint 3. | pendente |
| P11 | Login com a **mesma composição do cadastro** (citação à esquerda, formulário à direita). | produto |
| P12 | Domínio `casebook.com.br`, lido de `PUBLIC_BASE_URL` (nenhum domínio no código). Perfil público em **`/:handle`**; `/u/:handle` responde 308. | produto |
| P13 | Textos técnicos da landing (ProRes, HEVC, 4K…) não foram usados: a landing não foi implementada. | decidido por mim, revisar |
| P14 | Telas de Fase 2 (descoberta, showreel, "Contratar") não foram implementadas. O selo "Disponível para freelance" entrou por P5. | decidido por mim, revisar |
| P15 | Sem saudação com gênero: o título do dashboard é "Projetos". Pelos mesmos motivos, os papéis do passo 2 são funções ("Montagem", "Direção", "Cor"), não cargos ("Editor", "Diretor", "Colorista"). | decidido por mim, revisar |
| Contraste | **AA nos dois temas.** Os três pares que falhavam no design foram corrigidos pelo mínimo necessário (ver 8.2). | produto |
| Fonte | `@fontsource-variable/source-serif-4` (self-host por pacote, build sem internet). Archivo removida. | produto |

Outras leituras minhas, **decidido por mim, revisar**:

- **Passo pendente do onboarding.** Há um carimbo só (`onboarding_completed_at`). "Pular" no passo 2
  avança para o 3 sem gravar nada; concluir ou pular o passo 3 grava o carimbo. Quem volta com o
  onboarding aberto cai no passo 2 se ainda não tem papel, e no 3 se já tem.
- **Contas anteriores à migration 0004** entram com o onboarding concluído (backfill na migration).
- **Texto do passo 2.** O design promete posicionamento na busca e sugestão de blocos, que não
  existem. Ficou: "Eles aparecem no seu perfil público, e dá para mudar depois".
- **Citação do painel de entrada.** É o texto do design, atribuído a uma pessoa fictícia ("Rafael
  Lins"). **Precisa virar um depoimento real, ou sair, antes de ir ao ar.**
- **Aceite de termos** ("Ao continuar você aceita…") não foi incluído: não existem termos.
- **Conteúdo não acompanha o tema.** Página pública e painéis de mídia ficam escuros nos dois temas,
  como no design; só a UI do app troca.
- **"Perfil público" na navegação** abre `/:handle` em nova aba.
- **Ícones:** Phosphor duotone (`@phosphor-icons/react`); `lucide-react` removido.

## 8. Implementado

### 8.1 Tokens

Em [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css), no `@theme` do Tailwind 4:
cada token é ao mesmo tempo custom property e utilitário (`bg-surface`, `text-muted`). Componente
nenhum usa hex. O tema escuro é o valor padrão; o claro troca as mesmas variáveis em
`:root[data-theme='light']` e em `prefers-color-scheme: light` sem escolha.

| Token | Escuro (design) | Claro (**derivado**) |
| --- | --- | --- |
| `--color-bg` | `#0e0d0d` | `#f3f2f2` (papel do Broadsheet) |
| `--color-well` | `#080808` | `#e2e0e0` |
| `--color-surface` | `#171616` | `#eae9e9` (superfície do Broadsheet) |
| `--color-raised` | `#211f1f` (derivado) | `#dfdddd` |
| `--color-text` | `#f3f2f2` | `#201e1d` |
| `--color-text-secondary` | `#bab6b6` | `#444141` |
| `--color-muted` | `#9b9797` | `#605d5d` |
| `--color-subtle` | `#827e7e` (ajustado) | `#6b6767` |
| `--color-border` | branco a 13% | `#201e1d` a 16% |
| `--color-border-control` | `#666363` (novo) | `#898585` |
| `--color-track` | `#444141` | `#d7d3d3` |
| `--color-accent` / `--color-on-accent` | `#0088b0` / `#050505` | iguais |
| `--color-accent-hover` | `#38a6cf` (derivado) | igual |
| `--color-accent-text` / `-hover` | `#99e0ff` / `#cbeeff` | `#006786` / `#004961` |
| `--color-accent-tint` / `--color-on-accent-tint` | accent a 14% / `#cbeeff` | accent a 12% / `#004961` |
| `--color-danger` | `#ff1a8d` (ajustado) | `#b8005d` (ajustado) |
| `--color-danger-tint` / `-border` | magenta a 10% / `#aa0b56` | magenta a 8% / `#aa0b56` |

**Tokens de conteúdo** (`--color-content-bg`, `-surface`, `-text`, `-text-secondary`, `-muted`,
`-border`, `-accent`, `-on-accent`, `-accent-text`, `-accent-tint`): usados só pela página pública,
pelo preview do perfil e pelo painel de citação. A página pública vai sobrescrevê-los com a paleta
da mídia; a UI do app e o builder não leem nenhum deles, então não mudam de cor junto.

**Tipografia:** Source Serif 4 variável, só o eixo de peso, com `font-optical-sizing: none`. O
design carrega instâncias estáticas (400 e 600), sem tamanho óptico; com o eixo ligado os títulos
saem no corte "display", mais fino que o desenhado. Escala em `--text-caption` (12), `-support`
(14), `-body` (16), `-card` (19), `-section` (30), `-page` (38), `-screen` (44). A marca "CASEBOOK"
é peso 400 nas telas (a seção 2.2 dizia 600).

**Raios:** 1 / 2 / 4px. **Sombras:** `--shadow-menu`, `--shadow-dialog`.

### 8.2 Contraste (WCAG 2.1 AA)

Verificado por teste em [`tokens.test.ts`](../../apps/web/src/app/tokens.test.ts), que lê o
`globals.css` e falha se algum par cair abaixo de 4,5:1 (texto) ou 3:1 (componente de interface),
nos dois temas. Lighthouse acessibilidade: **100** em `/login` e `/signup`.

Onde o design não passava, o valor foi ajustado pelo mínimo:

| Par | No design | Ajuste |
| --- | --- | --- |
| Legenda (`neutral-600` `#7d7979`) sobre superfície | 4,2:1 | `--color-subtle` `#827e7e` |
| Borda de input (branco a 13%) | 1,4:1 | token novo `--color-border-control` `#666363`, só para contorno de controle (input, switch, botão secundário, área tracejada). Divisores continuam em 13%. |
| Borda tracejada (`neutral-700`) | 2,98:1 | usa `--color-border-control` |
| Magenta `#d6006c` como texto de erro, tema escuro | 3,8:1 sobre o fundo | `#ff1a8d`: mesmo matiz, luminosidade 42% → 55% |
| Magenta `#d6006c` como texto de erro, tema claro | 4,6:1 sobre o fundo, 4,3:1 sobre superfície e sobre a tinta de erro | `#b8005d`: mesmo matiz, luminosidade 42% → 36% |
| Link no meio de frase | só a cor o distinguia | sublinhado sempre |

A borda de input mais visível é a diferença que mais se nota em relação ao design.

### 8.3 Derivados — sem desenho, para revisar no Claude Design

Feitos a partir dos tokens, da tipografia, dos raios e do espaçamento do design, sem estilo novo.
Todos aparecem em `/ui` (só em desenvolvimento) e nas capturas `screenshots/app/componentes-*`.

| Item | Como foi derivado |
| --- | --- |
| **Tema claro inteiro** | rampas do Broadsheet nos mesmos papéis semânticos |
| Login | composição da tela 1.2, com email e senha |
| Aba Conta (handle, senha, sessões) | campos e seções da tela 2.6 |
| Menu da conta e dropdown | superfície + borda do card, item destacado em `raised` |
| Carregamento de sessão / do app | ícone `circle-notch` do design (2.7b) girando, texto atenuado |
| Erro de campo | texto em `danger` com ícone, borda do input em `danger` |
| Aviso (`Notice`) de sucesso e de informação | o de perigo existe (2.4); os outros dois seguem a mesma caixa com a tinta de accent e a neutra |
| Toast | card com sombra de menu |
| Skeleton | faixa de `surface` → `raised` (o `cbShimmer` declarado e sem uso no design) |
| Botão: hover, foco, disabled, loading | hover em `accent-500`; foco com contorno em `accent-text`; disabled a 45% |
| Botão de perigo | caixa "Excluir conta" da tela 2.6 |
| Select com busca (fuso) | input do design + lista no estilo do menu |
| Seletor de tema (segmentado) | controle Editar/Preview da tela 2.2 |
| Indicador de força da senha | barras de 2px do indicador de passos |
| Página 404 | estado vazio |
| Barra superior e menu da conta no mobile | o design mobile não mostra a conta |
| Passo 3 no mobile | o design só tem o desktop; no mobile o preview some |

### 8.4 Telas

| Tela | Rota | Design | Capturas |
| --- | --- | --- | --- |
| Login | `/login` | derivada de 1.2 | `app/login-*` |
| Cadastro, passo 1 | `/signup` | 1.2, 1.6b | `app/cadastro-*` |
| Papel, passo 2 | `/onboarding/role` | 1.3, 1.6c | `app/onboarding-papel-*` |
| Perfil, passo 3 | `/onboarding/profile` | 1.4 | `app/onboarding-perfil-*` |
| Projetos (vazio) | `/app` | 1.5, 2.7b | `app/app-projetos-*` |
| Biblioteca (vazio) | `/app/media` | sem desenho | `app/app-biblioteca-*` |
| Configurações → Perfil | `/app/settings/profile` | 2.6 | `app/config-perfil-*` |
| Configurações → Conta | `/app/settings/account` | derivada de 2.6 | `app/config-conta-*` |
| Perfil público (esboço) | `/:handle` | 3.3, sem showreel nem projetos | `app/perfil-publico-*` |
| Catálogo de componentes | `/ui` (dev) | — | `app/componentes-*` |

As capturas são geradas por `SCREENSHOTS=1 pnpm --filter @casebook/web test:e2e screenshots`.

## 9. Sprint 2 — alinhamento da mídia com o design

Decisões de produto de **2026-10-02** para a Sprint 2 (upload e pipeline de imagem), tiradas do
Fluxo 2 (telas 2.1, dashboard com card em processamento, e 2.2, painel "Mídia do projeto" do
builder) e do Fluxo 1 (tela 1.4, "Trocar foto"). Valem para as três partes da sprint. "Parte" diz
onde cada uma é implementada; as que mudam requisitos estão também em
[`requisitos.md`](../requisitos.md), com o texto anterior riscado.

### 9.1 Onde o design promete mais do que o MVP entrega

O painel 2.2 diz "ProRes, H.264/265, DNG, TIFF", mostra um `.mov` transcodificando com "1080p já
disponível para preview" e fala em "master original… para download por link privado". Nada disso é
da Sprint 2:

| No design | Decisão | Parte |
| --- | --- | --- |
| Vídeo aceito na área de soltar arquivos | **Atrás de flag.** `MEDIA_VIDEO_ENABLED=false` por padrão: a intenção de upload de vídeo responde 422 com tipo próprio (`media-video-not-available`) e "Vídeo chega em breve.". A Sprint 6 liga a flag. | 1 — feito |
| DNG entre os formatos aceitos | **RAW fora do MVP.** DNG, CR2, CR3, NEF, ARW e afins → 422 (`media-raw-not-supported`): "Arquivos RAW não são aceitos porque a revelação muda a cor. Exporte em TIFF 16 bits ou JPEG do seu revelador." A API detecta pela extensão e pelo MIME na intenção; o worker, pelo conteúdo (DNG é TIFF por dentro). Registrado em RF-UP-4. | 1 — feito (API); 2 (sniff no worker) |
| "1080p já disponível" enquanto o 4K processa | **Imagens continuam atômicas** (§6 dos requisitos: `ready` só com todos os derivativos). Disponibilidade progressiva de vídeo está em [`tech-debt.md`](../tech-debt.md), Planejado, Sprint 6: exige estender a máquina de estados. | — |
| Formatos na área de soltar | "JPEG, PNG, TIFF, HEIC, WebP, AVIF" (`ACCEPTED_IMAGE_FORMATS_LABEL` em `@casebook/contracts/media`). | 3 |
| "Download por link privado" do master | Fora da Sprint 2. A frase do rodapé fica só com a parte verdadeira (ver 9.3). | 3 |

### 9.2 Progresso no card

O design mostra percentual no card (2.1: "Transcodificando 68%"; 2.2: nome + "68%" + barra de 3px +
duas linhas de status). O `MediaEvent` (`@casebook/contracts/media`, SSE na parte 2) carrega
`stage` e `progress` (0–100):

| `stage` | Onde | Texto no card |
| --- | --- | --- |
| `hashing` | cliente (sha256 antes da intenção) | "Calculando…" |
| `uploading` | cliente (PUT das partes) | "Enviando 42%" |
| `queued` | servidor | "Na fila" |
| `optimizing` | servidor, no máximo um evento a cada 500 ms | "Otimizando 68%" |
| `palette` | servidor | "Extraindo paleta" |

### 9.3 Componentes e textos (parte 3)

- Componentes em `components/media/`, fiéis à 2.2 e reutilizáveis no painel do builder (Sprint 3):
  `MediaDropzone` (borda tracejada `neutral-700` — no app, `--color-border-control`, ver 8.2 —,
  ícone `cloud-arrow-up`, título + formatos aceitos), `MediaProgressCard` (borda e fundo em tom de
  accent, nome + %, barra de 3px, duas linhas de status) e `MediaListItem` (miniatura 46×32, nome
  com reticências, "L×A · MB").
- Card em processamento no grid igual ao do dashboard (2.1): `circle-notch` pulsando, rótulo em
  caixa alta com %, barra de 3px no rodapé.
- Rodapé da biblioteca com a frase do design, sem a promessa de download: nenhum arquivo é
  recomprimido acima de 1 passe; o original fica guardado.
- **Avatar:** "Trocar foto" funciona no onboarding (1.4) e nas configurações, pelo mesmo seletor. O
  `Avatar` mostra a imagem (derivativo de 320) no menu da conta, no app shell e no perfil público,
  com a inicial como fallback.
- Painel de detalhes mostra o perfil de cor de origem e o de saída (ex.: "Display P3 · mantido").
- Navegação continua com "Biblioteca de mídia" (P6).

### 9.4 Cor e qualidade (parte 2)

- **Gamut:** fonte com ICC mais largo que sRGB (Display P3, Adobe RGB, ProPhoto) gera derivativos em
  **Display P3** com o perfil embutido; as demais, em sRGB. Nunca recortar cor sem necessidade. SSIM
  calculado no espaço de saída. A paleta é sempre sRGB (hex para CSS). Perfil de origem e de saída
  persistidos em `exif`, para o painel de detalhes. Fixture P3 obrigatória nos testes.
  Isso substitui o "perfil de cor convertido para sRGB" do plano de sprints.
- **Um passe a partir do original:** todo derivativo, inclusive as larguras menores, sai do original
  normalizado, nunca de outro derivativo. Coberto por teste.

### 9.5 Decisões de implementação da parte 1, **decidido por mim, revisar**

- **Retry volta para `uploaded`**, não para `processing` como dizia o §6: mesmo caminho do
  `complete` (estado + outbox na mesma transação). Registrado nos requisitos.
- **Soft delete sempre, e confirmação para qualquer bloco** que use a mídia, não só os publicados.
  Registrado em RF-LIB-3.
- **`jobId = outbox-<id>`**, não `outbox:<id>`: o BullMQ 6 recusa `:` em id customizado.
- **Apagar a mídia que é o avatar** limpa `profiles.avatar_media_id` na mesma transação.

