# ADR 0002 — Pipeline de imagem: upload direto, outbox, chaves imutáveis e qualidade por SSIM

- **Status:** aceita, com o alvo de tempo (RNF-3) em revisão — ver "Tempo de processamento"
- **Data:** 2026-10-03
- **Sprint:** 2 (partes 1 e 2)

## Contexto

A Sprint 2 leva um arquivo do navegador até um conjunto de derivativos servidos por CDN. Cinco
decisões desse caminho não são óbvias pelo código e custariam caro para desfazer: como o arquivo
chega ao storage, como o job chega à fila, como os derivativos são endereçados, como a qualidade
de cada um é escolhida e como o HEIC é decodificado.

## Decisão

### 1. Upload direto ao storage, enfileiramento por outbox

O navegador envia o arquivo direto ao object storage, em partes, por URLs presigned; a API só
emite as URLs e confere o resultado no `complete`. Um arquivo de 50 MB nunca passa pelo processo
da API.

O `complete` não fala com o Redis. Na mesma transação ele grava `media_assets.state = 'uploaded'`
e insere uma linha em `outbox_events`; um processo à parte, o relay, lê a tabela
(`LISTEN/NOTIFY` + poll de 5 s, `FOR UPDATE SKIP LOCKED`) e publica o job no BullMQ com
`jobId = outbox-<id>`. Se o Redis estiver fora, o upload do usuário termina normalmente e o
evento espera; quando o Redis volta, o relay publica. Se o relay cair entre publicar e marcar o
evento, publica de novo e o BullMQ descarta a duplicata pelo `jobId`.

**O teste que prova o RNF-6** ("zero job perdido em queda do Redis") é
`RNF-6: com o Redis fora, complete funciona e o evento espera; ao voltar, publica`, em
[`apps/api/test/media-pipeline.int.test.ts`](../../apps/api/test/media-pipeline.int.test.ts): o
relay fala com o Redis por um proxy TCP que o teste derruba; o `complete` responde 200, o evento
fica não publicado, e ao religar o proxy o job aparece na fila uma única vez. O mesmo arquivo
cobre a republicação sem duplicata e duas instâncias do relay em paralelo.

### 2. Chaves imutáveis para os derivativos

Cada derivativo é gravado em `m/{mediaId}/{largura}-{hash8}.{formato}`, onde `hash8` são os 8
primeiros hex do SHA-256 do próprio conteúdo. A mesma chave nunca aponta para bytes diferentes,
então todo derivativo é servido com `Cache-Control: public, max-age=31536000, immutable`.
Reprocessar um asset gera chaves novas e atualiza as linhas de `media_derivatives` (upsert no
índice `derivative_unique`, RNF-7); nenhuma CDN ou navegador fica servindo a versão antiga, e não
há purga de cache para fazer.

O custo: o objeto antigo fica órfão no bucket depois de um reprocessamento. Está no
[tech-debt](../tech-debt.md).

### 3. Bucket de derivativos público, com URLs não adivinháveis

Os originais ficam num bucket privado, acessíveis só por URL presigned. Os derivativos ficam num
bucket de leitura pública, sem assinatura: é o que permite servir direto da CDN, com cache
compartilhado, sem passar pela API (RNF-8).

O que protege um derivativo é a URL: `mediaId` é um UUID v4 (122 bits aleatórios) e o bucket não
permite listagem. Quem não recebeu a URL não tem como chegar a ela.

**Implicação para mídia ainda não publicada:** essa proteção é a de um link secreto, não a de
controle de acesso. Um derivativo existe e é acessível por URL desde o `ready`, antes de o
projeto ser publicado; qualquer pessoa com a URL — copiada do painel, de um log, de um histórico
de navegador — vê a imagem, e a URL não pode ser revogada sem apagar ou reprocessar o asset. Para
um portfólio isso é aceitável: o conteúdo se destina a ser público, e o que ainda não foi
publicado é rascunho, não segredo. Não é aceitável para material sob embargo ou NDA; se esse caso
entrar no produto, a saída é um segundo bucket privado para assets de projetos não publicados,
com URL assinada de vida curta, e a cópia para o bucket público no publish.

### 4. Qualidade guiada por SSIM, com busca só na largura de referência

Para cada imagem saem AVIF e WebP nas larguras 320, 640, 1024, 1600, 2400 e 3840 (as que cabem,
nunca com upscale) e um JPEG de fallback em 1600. A qualidade de cada um é a menor que mantém
SSIM ≥ 0,985 contra o original redimensionado para aquela largura.

Buscar a qualidade em cada largura e formato custaria até 6 × 2 × 5 = 60 encodes. Em vez disso:

1. **Referência.** Busca binária só em 1600 px, para AVIF, WebP e JPEG ao mesmo tempo, em 5
   passos, numa faixa por formato: AVIF 55–90, WebP 75–95, JPEG 75–95.
2. **Aplicação.** Nas outras larguras, um encode com a qualidade da referência e uma medição. Se
   ficar abaixo do alvo, sobe 5 pontos, até duas vezes, e depois vai ao máximo da faixa.
3. **Teto.** Se nem o máximo da faixa alcança o alvo, um último encode na qualidade máxima do
   formato (AVIF 98, WebP 100, JPEG 100). Se ainda assim não alcançar, o derivativo é aceito, o
   SSIM real é persistido e `media_derivatives.ssim_target_met` fica `false`.

Todo derivativo é medido por inteiro; não há amostragem. O AVIF usa `effort` 2: em 1600 px o
esforço 4 (padrão) custa 2,1 s por encode contra 0,25 s, para um arquivo 2 a 5% menor.

**Imagens com transparência.** Original e derivativo são compostos sobre o mesmo fundo, cinza
médio (`#808080`), antes da medição: cor sob pixel transparente não é visível e não deve contar,
e o cinza não esconde erro de borda nem em tema claro nem em escuro. O JPEG de fallback sai
achatado sobre esse fundo. AVIF e WebP mantêm o alfa. O WebP grava o alfa sem perda; o AVIF o
codifica com perda, na mesma qualidade da cor, então no AVIF o canal alfa é medido à parte e vale
o pior dos dois números.

**Cor.** Fonte com perfil de gamut maior que o sRGB (Display P3, Adobe RGB, ProPhoto) gera
derivativos em Display P3 com o perfil embutido, num pipeline de 16 bits; as demais saem em sRGB,
em 8 bits. O SSIM é medido no espaço de saída. A paleta é sempre sRGB.

**Onde a conta roda.** O SSIM é JavaScript puro e roda em `worker_threads`, sobreposto aos
encodes do libvips. O que só depende do original numa largura — a luma e a média e a variância
locais — é calculado uma vez e reaproveitado por todas as medições daquela largura. O worker
processa 2 jobs por vez e divide os núcleos entre eles: na escala do MVP (RNF-12) a latência de
uma imagem pesa mais que a vazão.

### 5. A variante de SSIM

"SSIM ≥ 0,985" só significa algo com a variante declarada; implementações diferentes dão números
diferentes para o mesmo par de imagens. A nossa
([`ssim.ts`](../../apps/worker-image/src/pipeline/ssim.ts)):

| Escolha | Valor |
| --- | --- |
| Referência | Wang, Bovik, Sheikh e Simoncelli (2004), SSIM de escala única |
| Canal | luma Y′ = 0,2126 R′ + 0,7152 G′ + 0,0722 B′ (BT.709), sobre os valores de 8 bits codificados, no espaço de cor da saída |
| Janela | gaussiana 11×11, σ = 1,5, aplicada como duas passadas 1D |
| Constantes | K1 = 0,01, K2 = 0,03, L = 255 |
| Bordas | só a região válida, sem preenchimento |
| Escala | a do próprio derivativo, sem a redução prévia da implementação de referência em MATLAB |
| Agregação | média do mapa, sobre a imagem inteira |
| Alfa | composição sobre `#808080`; no AVIF, o canal alfa também, à parte |

Sem a redução de escala, 0,985 é um limiar mais exigente do que o mesmo número medido pelo
`ssim.m` original ou em blocos sem sobreposição. A implementação confere com o
`structural_similarity` do scikit-image (mesmos parâmetros) com diferença máxima de 1,3 × 10⁻⁶ em
seis pares de teste, que estão no repositório com os valores esperados.

### 6. HEIC pelo `heif-dec`, fora do processo

O sharp pré-compilado traz o libheif só com AV1: lê AVIF, não lê HEIC (HEVC). As alternativas
eram compilar o libvips com libde265 — o que troca o binário pré-compilado por um build próprio
em toda imagem e no CI — ou decodificar fora do processo.

O worker chama o `heif-dec` do libheif, que converte o HEIC para um TIFF sem perda, e o pipeline
segue igual ao de qualquer outro formato. Três detalhes que não são óbvios:

- **A versão importa.** A saída TIFF existe a partir do libheif 1.18. A saída PNG, disponível
  antes, quebra com perfis comuns em fotos reais (o sRGB da HP, recusado pela libpng) e mesmo
  assim o processo sai com código 0 e arquivo vazio. A imagem Docker usa o 1.19 do
  bookworm-backports; o CI, o mesmo 1.19 pelo PPA `strukturag/libheif`.
- **O TIFF do libheif 1.19 descarta o ICC.** Sem o perfil, um HEIC de iPhone (Display P3) seria
  tratado como sRGB e perderia saturação. O worker lê o perfil do próprio HEIC (caixa `colr`) e o
  grava no TIFF.
- **O teto de pixels vale antes da decodificação.** O sharp nem lê o cabeçalho de um HEIC; o
  formato é reconhecido pela caixa `ftyp` e as dimensões saem da `ispe`.

**Impacto na imagem Docker:** +8 MB (`libheif-examples` e `libheif-plugin-libde265`, sem os
encoders). A imagem do worker foi de 290 MB para 320 MB na Sprint 2, somando o código e as
dependências novas; fica no limite de 320 MB da ADR 0001.

## Tempo de processamento

O RNF-3 pede p95 < 20 s do `complete` ao `ready`. Medido, o pipeline não cumpre esse alvo para
imagens grandes, e **o alvo revisado ainda está por definir** a partir dos números abaixo.

**Como foi medido.** Dez imagens reais (`apps/worker-image/fixtures/`, baixadas por script), pelo
pipeline completo com banco e storage de verdade, na imagem Docker do worker limitada a 4 CPUs
(`--cpus=4`, metade de uma CPX41 de 8 vCPUs) com 2 jobs simultâneos — `bench.ts`, duas rodadas,
com os pares trocados entre elas. O tempo é o do job; não inclui a espera na fila nem o relay.
Médias das duas rodadas:

| Imagem | MP | Saída | Tempo | Decode e normalização | Busca de referência | Demais larguras | Paleta | Upload | Encodes | Qualidade AVIF/WebP/JPEG | SSIM mínimo | Abaixo do alvo | Bytes / original |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pequena, 800 px | 0,6 | sRGB | 2,3 s | 0,1 s | 1,7 s | 0,4 s | 0,1 s | 0,0 s | 18 | 87/94/100 | 0,9857 | 0/7 | 1,53× |
| gráfico (Adobe RGB) | 5,5 | P3 | 13,9 s | 0,8 s | 3,2 s | 5,6 s | 0,2 s | 3,1 s | 25 | 56/75/75 | 0,9892 | 0/13 | 0,66× |
| noturna com ruído | 8,2 | sRGB | 21,8 s | 0,4 s | 7,0 s | 12,0 s | 0,1 s | 2,2 s | 25 | 90/94/100 | 0,9852 | 0/13 | 1,69× |
| TIFF 16 bits | 12,2 | sRGB | 32,5 s | 1,8 s | 6,0 s | 22,9 s | 0,6 s | 0,9 s | 29 | 84/91/100 | 0,9859 | 0/13 | 0,20× |
| HEIC | 13,3 | sRGB | 25,5 s | 1,7 s | 6,3 s | 17,1 s | 0,2 s | 0,1 s | 27 | 80/89/94 | 0,9852 | 0/13 | 0,98× |
| retrato | 14,3 | sRGB | 39,5 s | 0,6 s | 17,0 s | 21,6 s | 0,1 s | 0,1 s | 31 | 80/89/95 | 0,9854 | 0/13 | 1,46× |
| PNG com alfa | 22,1 | sRGB | 55,4 s | 0,8 s | 7,1 s | 44,0 s | 0,2 s | 2,3 s | 39 | 56/79/75 | 0,9854 | 0/13 | 0,37× |
| textura fina | 24,1 | sRGB | 63,3 s | 0,5 s | 12,3 s | 50,0 s | 0,3 s | 0,1 s | 32 | 75/83/90 | 0,9853 | 0/13 | 0,67× |
| céu liso | 30,1 | sRGB | 28,2 s | 0,5 s | 7,1 s | 19,8 s | 0,2 s | 0,5 s | 27 | 84/90/100 | 0,9852 | 0/13 | 0,70× |
| panorâmica | 34,2 | sRGB | 14,8 s | 0,2 s | 2,3 s | 12,0 s | 0,1 s | 0,1 s | 30 | 64/80/87 | 0,9851 | 0/13 | 0,21× |

"Decode e normalização" é o reconhecimento do formato, o HEIC, o EXIF e o quadro da largura de
referência; "demais larguras" inclui o decode e o resize de cada uma delas.

Percentis por faixa de megapixels do original, na condição pedida e em duas de comparação:

| Condição | Geral (p50 / p95) | Até 12 MP | 12–24 MP | Acima de 24 MP |
| --- | --- | --- | --- | --- |
| 4 CPUs, 2 jobs simultâneos (2 rodadas, n = 20) | 26,8 / 63,2 s | 13,9 / 22,6 s | 36,7 / 57,2 s | 28,2 / 63,3 s |
| 4 CPUs, uma imagem por vez (n = 10) | 22,7 / 55,2 s | 8,4 / 16,1 s | 31,4 / 46,4 s | 22,9 / 57,0 s |
| 8 CPUs, 2 jobs simultâneos (2 rodadas, n = 20) | 25,0 / 56,0 s | 9,9 / 14,7 s | 29,1 / 45,1 s | 27,7 / 56,1 s |

O que os números mostram:

- **Qualidade:** os 248 derivativos alcançaram SSIM ≥ 0,985; nenhum ficou com
  `ssim_target_met = false`. JPEG de imagem com ruído ou céu liso só alcança no teto (100).
- **Encodes:** 28,3 por imagem em média, contra 60 da busca em todas as larguras.
- **Tamanho:** a soma dos derivativos fica entre 0,20× e 1,69× o original, dentro do RNF-10 (2,5×).
- **Megapixels do original não explicam o tempo.** A panorâmica de 34 MP leva 15 s e o PNG de
  22 MP, 55 s. O que pesa é o número de pixels dos derivativos de 2400 e 3840 px, que depende da
  proporção: 3840 × 1536 na panorâmica, 3840 × 5760 no PNG.
- **O custo que sobra é o encode AVIF das larguras grandes.** Um AVIF de 3840 × 3840 leva cerca
  de 9 s com 2 threads, e a textura fina precisa de três (qualidade 75, 80 e 85) para alcançar o
  alvo nessa largura. Encode é 66% do tempo de tarefa; SSIM, 28%; decode e resize, 6%.
- **Mais núcleos ajudam pouco.** Com 8 CPUs o p95 cai de 63 s para 56 s: o encoder AV1 não
  aproveita as threads extras numa imagem só.
- **Memória:** pico de 4,8 GB com dois jobs grandes ao mesmo tempo.

## Consequências

- O `complete` depende só do Postgres e do storage. O Redis pode cair sem o usuário perceber.
- O relay é mais um processo para operar e monitorar.
- Um derivativo é público para quem tem a URL desde o `ready` (seção 3).
- Derivativos reprocessados deixam objetos órfãos no bucket.
- O tempo de processamento de imagens grandes fica acima do RNF-3 original (seção acima).
- HEIC depende de um binário externo com versão mínima; o boot não verifica a versão, e um
  `heif-dec` ausente aparece como falha transitória do job.
