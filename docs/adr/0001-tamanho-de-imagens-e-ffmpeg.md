# ADR 0001 — Tamanho das imagens Docker e estratégia de FFmpeg

- **Status:** aceita
- **Data:** 2026-10-01
- **Sprint:** 0 (fechamento)

## Contexto

### A meta de tamanho era irreal

A Sprint 0 definiu como meta api e worker-image abaixo de 250 MB e web abaixo de 200 MB. A meta
foi escrita sem medir a base: `node:22-slim` sozinha ocupa cerca de 227 MB, dos quais 120 MB são
o binário do Node. Com essa base, a meta do web é inalcançável e a da API exigiria um app com
menos de 25 MB.

Tamanhos medidos ao final da Sprint 0, já com os ganhos baratos aplicados (só binários nativos
glibc; `sharp` e `typescript` fora do standalone do Next):

| Imagem       | Tamanho | Composição                                                          |
| ------------ | ------- | ------------------------------------------------------------------- |
| api          | 307 MB  | base ~227 MB + 126 MB de `node_modules` de produção                 |
| worker-image | 290 MB  | base ~227 MB + app com sharp/libvips                                |
| web          | 259 MB  | base ~227 MB + 32 MB do standalone do Next                          |
| worker-video | 1,04 GB | venv 475 MB (scipy, PyAV, numpy, scikit-image) + ~400 MB do ffmpeg do apt + base Python |

### Dois FFmpeg no worker de vídeo

O worker-video carregava o FFmpeg duas vezes: as bibliotecas embutidas no wheel do PyAV e o
pacote `ffmpeg` do apt (5.1.9), este responsável por ~400 MB da imagem por causa das dependências
que o Debian arrasta junto.

### Evidência: a hipótese "PyAV sem libx264" foi testada e refutada

A primeira justificativa para manter o ffmpeg do apt era que os wheels do PyAV trariam um FFmpeg
em build LGPL, sem libx264, e que portanto o encode H.264 dependeria do CLI. **Isso é falso.**
Verificado no container do worker-video, com PyAV 18.1.0:

- `'libx264' in av.codecs_available` → `True` (também `libx264rgb`)
- o wheel traz `libx264-d6533a8d.so.165` e `libx265-f5385bb8.so.216` em `av.libs/`
- um encode real via PyAV com `libx264` produziu um stream `h264`, profile High, 24 frames,
  decodificado de volta sem erro

Ou seja: o PyAV sozinho consegue fazer o encode. Manter um CLI é uma escolha de arquitetura, não
uma necessidade técnica — e a decisão abaixo se apoia em outros motivos.

## Decisão

1. **Meta das imagens Node revisada para ≤ 320 MB.** A otimização de runtime (distroless, bundle)
   fica para a Sprint 8, quando o ganho de pull time puder ser medido no deploy real.

2. **O encode roda pelo FFmpeg CLI, em subprocess.** Três motivos:
   - **Isolamento de falha.** Um crash dentro do libav (arquivo corrompido, bug de codec) mata só
     o processo filho. O worker continua vivo, marca o job como falho e segue. In-process, o
     mesmo crash derruba o worker junto com o lock do BullMQ.
   - **Cancelamento por sinal.** Cancelar um transcode vira `SIGTERM` no filho, com limpeza feita
     pelo próprio FFmpeg. In-process, exigiria checagem cooperativa a cada frame.
   - **Ladder HLS em passe único.** Um `filter_complex` com `split` decodifica o original uma vez
     e gera todas as renditions, playlists e o `master.m3u8` num comando só.

3. **PyAV fica para probe, leitura de frames e cálculo de SSIM** — onde o acesso aos frames como
   arrays numpy, em processo, é exatamente o que se quer.

4. **O FFmpeg CLI é um build estático, fixado por versão e checksum.** Origem:
   [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), variante `linux64-gpl`, release
   `autobuild-2026-09-30-13-08`, build `ffmpeg-n8.1.3-9-g29e619e767-linux64-gpl-8.1`. O SHA256 do
   tarball é conferido no build, que aborta se não bater. Só `ffmpeg` e `ffprobe` vão para o
   runtime. Versão, origem e hash ficam num lugar só:
   [`apps/worker-video/scripts/fetch_ffmpeg.py`](../../apps/worker-video/scripts/fetch_ffmpeg.py),
   usado pelo Dockerfile e pelo CI.

   Dois critérios para escolher (e atualizar) o build:
   - **autobuild de fim de mês.** Os builds diários do BtbN são apagados após ~14 dias; os de fim
     de mês ficam retidos. Fixar num diário quebraria o build da imagem em duas semanas.
   - **mesmo major do FFmpeg embutido no PyAV.** Hoje ambos são FFmpeg 8.1.

Verificado na imagem final, rodando como o usuário não-root do worker: `ffmpeg -version` mostra
`n8.1.3`; `libx264` e `libx265` aparecem em `ffmpeg -encoders`; um encode HLS com duas renditions
via `split` gera `master.m3u8` e segmentos H.264 High válidos (conferidos com `ffprobe` e
decodificados pelo PyAV); `-progress pipe:1` emite `out_time_us` e termina com `progress=end`.

## Consequências

- **worker-video: 1040 MB → 931 MB (−109 MB).** O ganho é menor do que o tamanho do pacote apt
  sugeria, porque cada binário estático tem ~165 MB em disco e são dois. O venv Python (475 MB)
  passa a ser a maior parte da imagem.
- **Continuam existindo dois FFmpeg no container**, e eles podem divergir. Hoje estão quase
  alinhados: `libavcodec 62.28.102` no wheel do PyAV e `62.28.103` no CLI. Uma atualização do
  wheel ou do binário pode mudar isso. O probe (PyAV) e o encode (CLI) precisam concordar sobre
  os codecs suportados, então isso virou teste: `tests/unit/test_codecs.py` falha se `libx264`
  ou `libx265` sumir de qualquer um dos dois lados, e o CI roda esse teste contra o mesmo binário
  fixado da imagem.
- **Atualizar o FFmpeg passa a ser uma ação explícita** — trocar release, build e hash em
  `fetch_ffmpeg.py`. Não chegam mais correções de segurança via `apt upgrade`; em troca, o
  encoder não muda sem que alguém decida.
- **A imagem passa a distribuir um binário GPL** (`--enable-gpl --enable-version3`). Ele é
  executado como processo separado, não linkado ao código do worker.
- **O build fixado é só linux/amd64.** Para arm64 existe o asset `linuxarm64-gpl`, com outro hash.
- **As imagens Node ficam como estão** até a Sprint 8, dentro da meta revisada.

## Alternativas consideradas

### Encode in-process via PyAV — rejeitada

Tecnicamente viável (ver Evidência) e eliminaria o CLI inteiro, levando a imagem a ~600 MB.
Rejeitada pelos três motivos da Decisão: um crash do libav derrubaria o worker, o cancelamento
teria que ser cooperativo, e o ladder com `split` exigiria montar o grafo de filtros e os muxers
HLS à mão, reimplementando o que o CLI já entrega.

### Manter o ffmpeg do apt — rejeitada

É o caminho de menor esforço e recebe correções pelo Debian, mas custa ~110 MB a mais e prende o
encoder na versão da distro (5.1.9, três majors atrás do FFmpeg embutido no PyAV), ampliando a
divergência entre probe e encode.

### Compilar o FFmpeg do fonte — rejeitada por ora

Um build só com o necessário (libx264, libx265, AAC, muxer HLS) resultaria num binário estimado
em 20–40 MB, contra 330 MB dos dois estáticos — é a opção de menor imagem. O custo é um stage de
build longo e a manutenção de flags de configure e dependências. Não se justifica antes de haver
deploy real. Reavaliar na Sprint 8, junto com as imagens Node.

### Levar só o `ffmpeg`, sem o `ffprobe` — em aberto

Como o probe é feito pelo PyAV, o `ffprobe` é redundante na arquitetura decidida, e removê-lo
tiraria mais ~165 MB (imagem em ~765 MB). Foi mantido porque é útil para depurar dentro do
container. Decidir na Sprint 6, quando o pipeline de vídeo existir e der para saber se alguém o
usa.

### Imagens Node: distroless, base mínima ou bundle — adiadas para a Sprint 8

| Alternativa                                             | Ganho                                              | Custo                                                     |
| ------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `debian:bookworm-slim` + só o binário do Node           | ~25 MB por imagem (npm, corepack e yarn; medido)   | Sai da imagem oficial `node:22-slim`                      |
| Distroless (`gcr.io/distroless/nodejs22`)               | Estimado na mesma ordem ou um pouco mais; não medido | Sem shell para depurar; healthcheck precisa ser em Node  |
| Bundle único da API com SWC                             | Reduz os 126 MB de `node_modules`; não medido      | Precisa preservar metadados de decorators e os hooks de instrumentação OTel, que dependem de módulos não empacotados |

Nenhuma delas fecha a meta original: o binário do Node (120 MB) é piso em qualquer cenário. Por
isso a meta foi revisada em vez de perseguida.
