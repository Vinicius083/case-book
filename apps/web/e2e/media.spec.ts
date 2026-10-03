import { fileURLToPath } from 'node:url';

import { expect, signUp, test } from './fixtures';

// Imagem pequena (60 KB, 1600 × 1067, gerada por nós) para não pesar no CI.
const FIXTURE = fileURLToPath(new URL('./fixtures/still.jpg', import.meta.url));

// Fluxo inteiro com a infra de verdade: API, storage, relay e worker de imagem.
test('biblioteca: enviar, deduplicar, ver detalhes, usar como avatar e apagar', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await signUp(page);
  await page.goto('/app/media');
  await expect(page.getByRole('heading', { name: 'Biblioteca de mídia' })).toBeVisible();

  // Anota os estados por que os cards passam, para conferir no fim sem depender de
  // pegar cada um no instante certo.
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { seenStates: Set<string> }).seenStates = seen;
    const record = () => {
      for (const el of document.querySelectorAll('[data-state]')) {
        seen.add(el.getAttribute('data-state') ?? '');
      }
      for (const el of document.querySelectorAll('[aria-label="Envios"] [role="status"]')) {
        seen.add(el.textContent.replace(/\s*\d+%/, ''));
      }
    };
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });

  // 1. Enviar: o card chega a pronto sem recarregar a página (só os eventos SSE o atualizam).
  const files = page.getByRole('list', { name: 'Arquivos' });
  const card = files.getByRole('listitem').filter({ hasText: 'still.jpg' });
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await expect(card).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await expect(card.locator('img')).toBeVisible();
  await expect(card.getByText('1600 × 1067')).toBeVisible();

  const seen = await page.evaluate(() => [
    ...(window as unknown as { seenStates: Set<string> }).seenStates,
  ]);
  expect(seen.some((state) => /Calculando|Enviando|Finalizando/.test(state))).toBe(true);
  expect(seen.some((state) => state === 'uploaded' || state === 'processing')).toBe(true);

  // Nada de token no storage do browser: o access token vive só em memória, e o
  // SSE autentica por header.
  const stored = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
  );
  expect(stored).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);

  // 2. O mesmo arquivo de novo: deduplicado, nada é enviado e a biblioteca segue com um item.
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await expect(page.getByText('Você já tinha enviado esse arquivo')).toBeVisible();
  await expect(files.getByRole('listitem')).toHaveCount(1);

  // 3. Detalhes: derivativos com SSIM dentro do alvo.
  await card.getByRole('button', { name: 'Ver detalhes de still.jpg' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Derivativos' })).toBeVisible();
  const ssims = await panel
    .locator('[data-ssim]')
    .evaluateAll((cells) => cells.map((cell) => Number(cell.getAttribute('data-ssim'))));
  // 320, 640, 1024 e 1600 em AVIF e WebP, mais o JPEG de 1600.
  expect(ssims).toHaveLength(9);
  for (const ssim of ssims) expect(ssim).toBeGreaterThanOrEqual(0.985);
  await expect(panel.getByText('Casebook Fixture E2E')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // 4. Foto de perfil: escolhida da biblioteca, aparece no perfil público.
  await page.goto('/app/settings/profile');
  await page.getByRole('button', { name: 'Escolher foto' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /still\.jpg/ })
    .click();
  await expect(page.getByText('Foto de perfil atualizada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trocar foto' })).toBeVisible();

  await page.goto(`/${user.handle}`);
  const avatar = page.locator('[data-avatar="photo"] img');
  await expect(avatar).toBeVisible();
  await expect
    .poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(320);

  // 5. Apagar: confirmação, e a biblioteca volta a ficar vazia.
  await page.goto('/app/media');
  await page.getByRole('button', { name: 'Ver detalhes de still.jpg' }).click();
  await page.getByRole('button', { name: 'Apagar arquivo' }).click();
  await page.getByRole('button', { name: 'Sim, apagar' }).click();
  await expect(page.getByText('"still.jpg" foi apagado.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Arquivos' })).toHaveCount(0);
  await expect(page.getByText('Arraste arquivos ou escolha do computador')).toBeVisible();
});
