# Fixtures do worker de imagem

## `test/` — versionadas, usadas pelos testes

| Arquivo                            | O que é                                                                                                                                                                         | Origem e licença                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ssim/*.png`, `ssim/expected.json` | Pares 96×80 em tons de cinza e o SSIM de cada par medido pelo scikit-image 0.26 (`structural_similarity`, janela gaussiana σ = 1,5, covariância populacional, `data_range=255`) | Gerados por nós (numpy, semente fixa) — CC0                                      |
| `tiny.heic`                        | HEIC 480×312                                                                                                                                                                    | `heic-source.jpg` (abaixo, CC0) reduzida e codificada com `heif-enc -q 70` — CC0 |
| `tiny-p3.heic`                     | HEIC 480×320 com perfil Display P3 (11 KB)                                                                                                                                      | Gerado por nós (faixas de cor pura, `heif-enc`) — CC0                            |

As demais imagens de teste (fonte Display P3, DNG sintético, PNG com cabeçalho de 400 MP,
JPEG sintético) são geradas na hora por [`../test/images.ts`](../test/images.ts).

## `bench/` — fora do git, baixadas por script

Dez imagens reais (~135 MB), usadas pelo benchmark da estratégia de SSIM (ver
[ADR 0002](../../../docs/adr/0002-pipeline-de-imagem.md)) e por
[`../test/fixtures.int.test.ts`](../test/fixtures.int.test.ts), que é pulado quando elas não estão
na pasta.

`pnpm --filter @casebook/worker-image fixtures:fetch` baixa cada uma do Wikimedia Commons, confere
o SHA-256 contra [`manifest.json`](manifest.json) e gera o `phone.heic` (exige o `heif-enc` do
libheif com o plugin x265; sem ele, o HEIC é pulado com aviso). No CI a pasta fica em cache, com a
chave pelo hash do manifesto: só baixa de novo quando o manifesto muda.

| Arquivo             | Caso                                        | Licença         | Autor            |
| ------------------- | ------------------------------------------- | --------------- | ---------------- |
| `portrait.jpg`      | retrato                                     | CC BY-SA 4.0    | Dmitry Makeev    |
| `landscape-sky.jpg` | paisagem com céu liso                       | CC BY-SA 4.0    | Roman Eisele     |
| `texture.jpg`       | textura fina (tecido)                       | CC BY-SA 4.0    | Chrisciteya      |
| `night-noise.jpg`   | noturna com ruído                           | CC0             | Wilfredor        |
| `alpha.png`         | PNG com transparência                       | CC0             | PxHere.com       |
| `tiff16.tif`        | TIFF 16 bits                                | CC BY 3.0       | Biswarup Ganguly |
| `phone.heic`        | HEIC (de `heic-source.jpg`, CC0, Wilfredor) | CC0             | —                |
| `small-800.jpg`     | pequena, 800px                              | CC BY-SA 2.0    | Logan Campbell   |
| `panorama.jpg`      | panorâmica                                  | CC BY-SA 3.0    | King of Hearts   |
| `chart.png`         | gráfico com texto (Adobe RGB)               | Domínio público | NASA/JPL         |

Links das páginas de origem e das licenças no `manifest.json`.
