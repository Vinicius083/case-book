import { fileURLToPath } from 'node:url';

import { expect, newUser, signUp, test } from './fixtures';

// Gera as capturas de tela usadas no PR e na documentação. Não é um teste: só roda
// com SCREENSHOTS=1 (`SCREENSHOTS=1 pnpm test:e2e screenshots`).
const OUT = fileURLToPath(new URL('../../../docs/screenshots/sprint-1/', import.meta.url));

test.skip(!process.env['SCREENSHOTS'], 'defina SCREENSHOTS=1 para gerar as capturas');
test.use({ viewport: { width: 1440, height: 900 } });

test('capturas das telas da sprint 1', async ({ page }) => {
  const user = {
    ...newUser(),
    displayName: 'Ana Lima',
    handle: `ana-lima-${Date.now().toString(36)}`,
  };

  await page.goto('/login');
  await page.screenshot({ path: `${OUT}login.png` });

  await page.goto('/signup');
  await page.getByLabel('Nome de exibição').fill(user.displayName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByLabel('Handle').fill('admin');
  await expect(page.getByText(/^Reservado:/)).toBeVisible();
  await page.screenshot({ path: `${OUT}signup-handle-reservado.png` });
  await page.getByLabel('Handle').fill(user.handle);
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${OUT}signup.png` });

  await signUp(page, user);
  await expect(page.getByRole('button', { name: `Conta de ${user.displayName}` })).toBeVisible();
  await page.screenshot({ path: `${OUT}app-projetos.png` });

  await page.getByRole('button', { name: /^Conta de / }).click();
  await expect(page.getByRole('menuitem', { name: 'Sair', exact: true })).toBeVisible();
  await page.screenshot({ path: `${OUT}app-menu-conta.png` });
  await page.keyboard.press('Escape');

  await page.goto('/app/media');
  await expect(page.getByRole('heading', { name: 'Biblioteca de mídia', level: 1 })).toBeVisible();
  await page.screenshot({ path: `${OUT}app-biblioteca.png` });

  await page.goto('/app/settings/profile');
  await page
    .getByLabel('Bio')
    .fill('Montadora e colorista.\nDocumentário, videoclipe e publicidade.');
  await page.getByLabel('Localização').fill('São Paulo, SP');
  for (const role of ['montagem', 'cor']) {
    await page.getByLabel('Papéis na produção').fill(role);
    await page.getByLabel('Papéis na produção').press('Enter');
  }
  await page.getByRole('button', { name: 'Adicionar link' }).click();
  await page.getByLabel('Rótulo').fill('Vimeo');
  await page.getByLabel('Endereço').fill('https://vimeo.com/analima');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('Perfil salvo.')).toBeVisible();
  await page.screenshot({ path: `${OUT}settings-perfil.png` });
  await page.getByRole('heading', { name: 'Handle', level: 2 }).scrollIntoViewIfNeeded();
  await page.getByLabel('Novo handle').fill('admin');
  await expect(page.getByText(/^Reservado:/)).toBeVisible();
  await page.getByRole('heading', { name: 'Senha', level: 2 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}settings-handle-senha.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${OUT}settings-perfil-mobile.png` });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
  await page.screenshot({ path: `${OUT}app-projetos-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`/u/${user.handle}`);
  await expect(page.getByRole('heading', { name: user.displayName, level: 1 })).toBeVisible();
  await page.screenshot({ path: `${OUT}perfil-publico.png` });
});
