import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, newUser, signUp, test } from './fixtures';

import type { Page } from '@playwright/test';

// Gera as capturas de tela usadas no PR e em docs/design. Não é um teste: só roda
// com SCREENSHOTS=1 (`SCREENSHOTS=1 pnpm test:e2e screenshots`).
const DESIGN_DIR = fileURLToPath(new URL('../../../docs/design/', import.meta.url));
const OUT = `${DESIGN_DIR}screenshots/`;

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

test.skip(!process.env['SCREENSHOTS'], 'defina SCREENSHOTS=1 para gerar as capturas');
test.use({ viewport: DESKTOP });
test.setTimeout(180_000);

test.beforeAll(() => {
  mkdirSync(`${OUT}app`, { recursive: true });
  mkdirSync(`${OUT}design`, { recursive: true });
});

// Transições terminadas e ponteiro fora da tela: senão a captura pega um hover ou
// uma cor no meio do caminho.
const SETTLED = { animations: 'disabled' } as const;

/** A mesma tela em 1440 e em 390. */
async function shot(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  await page.mouse.move(0, 0);
  for (const [size, viewport] of [
    ['1440', DESKTOP],
    ['390', MOBILE],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `${OUT}app/${name}-${size}.png`, ...SETTLED, ...options });
  }
  await page.setViewportSize(DESKTOP);
}

test('telas implementadas, em 1440 e 390', async ({ page }) => {
  const user = {
    ...newUser(),
    displayName: 'Marina Duarte',
    handle: `marina-duarte-${Date.now().toString(36)}`,
  };

  await page.goto('/login');
  await shot(page, 'login');

  await page.goto('/signup');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Informe o nome de exibição')).toBeVisible();
  await shot(page, 'cadastro-erros');

  await page.getByLabel('Nome de exibição').fill(user.displayName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill(user.password);
  await page.getByLabel('Handle').fill(user.handle);
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await page.getByLabel('Email').focus();
  await shot(page, 'cadastro');

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL('/onboarding/role');
  await page.getByRole('button', { name: /^Cor/ }).click();
  await page.getByRole('button', { name: /^Finalização/ }).click();
  await shot(page, 'onboarding-papel');

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL('/onboarding/profile');
  await page
    .getByLabel('Bio')
    .fill(
      'Colorista com base em SP. Comerciais, videoclipes e documentário. Trabalho em Baselight e Resolve.',
    );
  await page.getByLabel('Localização').fill('São Paulo, BR');
  await page.getByLabel('Fuso de trabalho').fill('sao paulo');
  await page.getByRole('option', { name: /America\/Sao Paulo/ }).click();
  await page.getByRole('switch', { name: 'Disponível para freelance' }).click();
  await shot(page, 'onboarding-perfil');

  await page.getByRole('button', { name: 'Salvar e entrar' }).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
  await shot(page, 'app-projetos');

  await page.getByRole('button', { name: /^Conta de / }).click();
  await expect(page.getByRole('menuitem', { name: 'Sair', exact: true })).toBeVisible();
  await page.screenshot({ path: `${OUT}app/app-menu-conta-1440.png` });
  await page.keyboard.press('Escape');

  await page.goto('/app/media');
  await expect(page.getByRole('heading', { name: 'Biblioteca de mídia', level: 1 })).toBeVisible();
  await shot(page, 'app-biblioteca');

  await page.goto('/app/settings/profile');
  await page.getByRole('button', { name: 'Adicionar link' }).click();
  await page.getByLabel('Rótulo').fill('Vimeo');
  await page.getByLabel('Endereço').fill('https://vimeo.com/marinaduarte');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('Perfil salvo.')).toBeVisible();
  await shot(page, 'config-perfil', { fullPage: true });

  await page.goto('/app/settings/account');
  await page.getByLabel('Novo handle').fill('admin');
  await expect(page.getByText(/^Reservado:/)).toBeVisible();
  await shot(page, 'config-conta', { fullPage: true });

  await page.goto(`/${user.handle}`);
  await expect(page.getByRole('heading', { name: user.displayName, level: 1 })).toBeVisible();
  await shot(page, 'perfil-publico');

  await page.goto('/ui');
  await expect(page.getByRole('heading', { name: 'Componentes', level: 1 })).toBeVisible();
  await shot(page, 'componentes', { fullPage: true });

  // Tema claro (derivado): as mesmas telas, para revisão no Claude Design.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${OUT}app/componentes-1440-claro.png`, fullPage: true });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
  await page.screenshot({ path: `${OUT}app/app-projetos-1440-claro.png` });
  await page.goto('/app/settings/profile');
  await expect(page.getByLabel('Bio')).toBeVisible();
  await page.screenshot({ path: `${OUT}app/config-perfil-1440-claro.png`, fullPage: true });
  await page.goto('/onboarding/role');
  await page.context().clearCookies();
  await page.goto('/login');
  await page.screenshot({ path: `${OUT}app/login-1440-claro.png` });
  await page.goto('/signup');
  await page.screenshot({ path: `${OUT}app/cadastro-1440-claro.png` });
});

/** A mesma tela em 1440 e 390, no tema escuro e no claro. */
async function shotThemes(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  await page.mouse.move(0, 0);
  for (const [scheme, suffix] of [
    ['dark', ''],
    ['light', '-claro'],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [size, viewport] of [
      ['1440', DESKTOP],
      ['390', MOBILE],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.screenshot({
        path: `${OUT}app/${name}-${size}${suffix}.png`,
        ...SETTLED,
        ...options,
      });
    }
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize(DESKTOP);
}

// Biblioteca com mídia de verdade: precisa do relay e do worker de imagem (o
// webServer do Playwright sobe os dois). Além da fixture do E2E, usa as fotos CC0
// de apps/worker-image/fixtures/bench, se já foram baixadas (`fixtures:fetch`).
test('biblioteca de mídia e painel de detalhes, em 1440 e 390, escuro e claro', async ({
  page,
}) => {
  const still = fileURLToPath(new URL('./fixtures/still.jpg', import.meta.url));
  const bench = fileURLToPath(new URL('../../worker-image/fixtures/bench/', import.meta.url));
  const extras = ['night-noise.jpg', 'heic-source.jpg']
    .map((name) => `${bench}${name}`)
    .filter((path) => existsSync(path));

  await signUp(page, { ...newUser(), displayName: 'Marina Duarte' });
  await page.goto('/app/media');
  const input = page.locator('input[type="file"]').first();
  const files = page.getByRole('list', { name: 'Arquivos' });

  await input.setInputFiles(still);
  await expect(files.locator('[data-state="ready"]')).toHaveCount(1, { timeout: 60_000 });

  if (extras.length > 0) {
    await input.setInputFiles(extras);
    // No meio do caminho: envio em curso e card em processamento.
    await expect(files.locator('[data-state="processing"]').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(files.getByText(/Otimizando \d+%/).first()).toBeVisible({ timeout: 30_000 });
    await shotThemes(page, 'app-biblioteca-processando');
    await expect(files.locator('[data-state="ready"]')).toHaveCount(1 + extras.length, {
      timeout: 150_000,
    });
  }
  // As imagens do grid carregaram.
  await expect
    .poll(() =>
      files
        .locator('img')
        .evaluateAll((imgs) =>
          imgs.every(
            (img) =>
              (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await shotThemes(page, 'app-biblioteca-com-midia');

  await page
    .getByRole('button', { name: /^Ver detalhes de / })
    .first()
    .click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Derivativos' })).toBeVisible();
  await expect
    .poll(() =>
      panel
        .locator('img')
        .first()
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await shotThemes(page, 'app-midia-detalhes');
  await panel.getByRole('heading', { name: 'Paleta' }).scrollIntoViewIfNeeded();
  await shotThemes(page, 'app-midia-detalhes-paleta');
});

// As telas do design, recortadas do export (docs/design/source), para ficar lado
// a lado com as implementadas.
const DESIGN_SCREENS = {
  'Fluxo 1 - Cadastro e Perfil.dc.html': [
    '1.2 Cadastro',
    '1.3 Especialidade',
    '1.4 Criação de perfil',
    '1.5 Dashboard vazio',
    '1.6b Mobile cadastro',
    '1.6c Mobile papel',
  ],
  'Fluxo 2 - Builder e Publicação.dc.html': ['2.6 Configurações', '2.7b Mobile dashboard'],
  'Fluxo 3 - Descoberta e Perfil Público.dc.html': ['3.3 Perfil público'],
} as const;

test.describe('export do Claude Design', () => {
  // Sem o X-Forwarded-For das fixtures: header extra faz o CDN de fontes recusar (CORS).
  test.use({ extraHTTPHeaders: {} });

  test('telas do design', async ({ page }) => {
    for (const [file, screens] of Object.entries(DESIGN_SCREENS)) {
      await page.goto(pathToFileURL(`${DESIGN_DIR}source/${file}`).href);
      // Fontes e ícones do export vêm de CDN: espera a rede e a fonte de fato carregada.
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => document.fonts.load('600 16px "Source Serif 4"'));
      await page.evaluate(() => document.fonts.ready);
      for (const label of screens) {
        const screen = page.locator(`[data-screen-label="${label}"]`);
        await screen.scrollIntoViewIfNeeded();
        const slug = label
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .replaceAll(/[^a-z0-9]+/g, '-');
        await screen.screenshot({ path: `${OUT}design/${slug}.png` });
      }
    }
  });
});
