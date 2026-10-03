// Baixa as imagens reais do worker (fixtures/bench/, fora do git), confere o
// SHA-256 de cada uma contra o manifest.json e gera o HEIC a partir da fonte CC0.
// Usadas pelo benchmark (ADR 0002) e por test/fixtures.int.test.ts; no CI ficam em cache.
//
//   pnpm --filter @casebook/worker-image fixtures:fetch
//
// O HEIC exige o heif-enc do libheif com o plugin x265 (HEIF_ENC_BIN); sem ele,
// o arquivo é pulado com aviso.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
// Política do Wikimedia: User-Agent identificando o projeto.
const userAgent = 'casebook-fixtures/1.0 (https://github.com/Vinicius083/case-book)';
mkdirSync(join(root, 'bench'), { recursive: true });

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** GET com novas tentativas: o Wikimedia limita a taxa de quem baixa em sequência. */
async function download(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': userAgent } }).catch((err) => err);
    if (res instanceof Response && res.ok) return Buffer.from(await res.arrayBuffer());
    const reason = res instanceof Response ? `HTTP ${res.status}` : String(res);
    if (attempt === 4) throw new Error(reason);
    const retryAfter = res instanceof Response ? Number(res.headers.get('retry-after')) : 0;
    const wait = Math.max(retryAfter * 1000, 2000 * 2 ** attempt);
    console.warn(`aviso    ${reason}; nova tentativa em ${wait / 1000}s`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

for (const entry of manifest) {
  const path = join(root, 'bench', entry.file);
  if (existsSync(path) && sha256(readFileSync(path)) === entry.sha256) {
    console.log(`ok       ${entry.file}`);
    continue;
  }
  const data = await download(entry.url).catch((err) => {
    throw new Error(`${entry.file}: ${err.message}`);
  });
  if (sha256(data) !== entry.sha256) throw new Error(`${entry.file}: SHA-256 não confere`);
  writeFileSync(path, data);
  console.log(
    `baixado  ${entry.file} (${(data.length / 1048576).toFixed(1)} MB, ${entry.license})`,
  );
}

const heicSource = join(root, 'bench', 'heic-source.jpg');
const heic = join(root, 'bench', 'phone.heic');
const heifEnc = process.env.HEIF_ENC_BIN ?? 'heif-enc';
if (existsSync(heic)) {
  console.log('ok       phone.heic');
} else {
  try {
    execFileSync(heifEnc, ['-q', '80', '-o', heic, heicSource], { stdio: 'ignore' });
    console.log('gerado   phone.heic (heif-enc -q 80, de heic-source.jpg)');
  } catch {
    console.warn(
      `aviso    phone.heic não gerado: ${heifEnc} indisponível (libheif-examples + x265)`,
    );
  }
}
