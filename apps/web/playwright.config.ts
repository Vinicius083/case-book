import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

// Mesmo .env da raiz que os apps usam (DATABASE_URL para o teardown, entre outros).
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// E2E contra servidores próprios, em portas que não colidem com o `pnpm dev`:
// a API buildada e o Next em build de produção, mais o relay e o worker de
// imagem (o upload vai até `ready` de verdade), sobre o Postgres, o Redis e o
// MinIO do compose (`pnpm infra:up`, ou os services do CI). Antes: `pnpm build`
// e `pnpm db:migrate`. O relay e o worker usam a fila e o outbox do banco: pare o
// `pnpm dev` antes, senão os de dev pegam os eventos.
const WEB_PORT = 3100;
const API_PORT = 3101;
const WEB_URL = `http://localhost:${String(WEB_PORT)}`;
const API_URL = `http://localhost:${String(API_PORT)}`;
const CI = Boolean(process.env['CI']);
const NODE_FLAGS =
  '--env-file-if-exists=../../.env --enable-source-maps --import ./dist/instrumentation.js';

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    locale: 'pt-BR',
    // Tema padrão do produto. Sem isto o Chromium de teste pede "claro" e as telas
    // sairiam no tema derivado.
    colorScheme: 'dark',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      cwd: '../api',
      command: `node ${NODE_FLAGS} dist/main.js`,
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      env: {
        API_PORT: String(API_PORT),
        WEB_URL,
        // Cada teste manda um X-Forwarded-For próprio (ver e2e/fixtures.ts): assim
        // os limites por IP de um teste não derrubam o seguinte.
        TRUST_PROXY: 'true',
      },
    },
    {
      name: 'relay',
      cwd: '../relay',
      command: `node ${NODE_FLAGS} dist/main.js`,
      wait: { stdout: /\[relay\] publicando/ },
      stdout: 'pipe',
      reuseExistingServer: false,
    },
    {
      name: 'worker-image',
      cwd: '../worker-image',
      command: `node ${NODE_FLAGS} dist/main.js`,
      wait: { stdout: /\[image\] ouvindo fila/ },
      stdout: 'pipe',
      reuseExistingServer: false,
    },
    {
      name: 'web',
      // `rewrites` é resolvido no build: a URL da API de teste entra aqui.
      command: `next build && next start --port ${String(WEB_PORT)}`,
      url: `${WEB_URL}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        NEXT_DIST_DIR: '.next-e2e',
        API_URL,
        PUBLIC_BASE_URL: WEB_URL,
        // Libera /ui (catálogo de componentes) no build de produção do teste.
        DEV_UI: '1',
        OTEL_EXPORTER_OTLP_ENDPOINT:
          process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318',
      },
    },
  ],
});
