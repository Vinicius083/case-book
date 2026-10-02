import { expect, publicAddress, signUp, test } from './fixtures';

test('edição de bio persiste após reload', async ({ page }) => {
  await signUp(page);
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Configurações' })
    .click();
  await expect(page).toHaveURL('/app/settings/profile');

  const bio = 'Montadora e colorista.\nTrabalho com documentário e videoclipe.';
  await page.getByLabel('Bio').fill(bio);
  await expect(page.getByText(`${String(bio.length)}/500`)).toBeVisible();
  await page.getByLabel('Localização').fill('São Paulo, SP');
  // fuso: select com busca, sem acento e sem underline
  await page.getByLabel('Fuso de trabalho').fill('sao pau');
  await page.getByRole('option', { name: /America\/Sao Paulo/ }).click();
  await expect(page.getByLabel('Fuso de trabalho')).toHaveValue('America/Sao Paulo');
  await page.getByRole('switch', { name: 'Disponível para freelance' }).click();
  await page.getByRole('button', { name: 'Adicionar link' }).click();
  await page.getByLabel('Rótulo').fill('Vimeo');
  await page.getByLabel('Endereço').fill('https://vimeo.com/exemplo');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('Perfil salvo.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Bio')).toHaveValue(bio);
  await expect(page.getByLabel('Localização')).toHaveValue('São Paulo, SP');
  await expect(page.getByLabel('Fuso de trabalho')).toHaveValue('America/Sao Paulo');
  await expect(page.getByRole('switch', { name: 'Disponível para freelance' })).toBeChecked();
  await expect(page.getByLabel('Endereço')).toHaveValue('https://vimeo.com/exemplo');
});

test('link que não é https mostra o erro no campo', async ({ page }) => {
  await signUp(page);
  await page.goto('/app/settings/profile');

  await page.getByRole('button', { name: 'Adicionar link' }).click();
  await page.getByLabel('Rótulo').fill('Site');
  await page.getByLabel('Endereço').fill('http://exemplo.com');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();

  await expect(page.getByText('Use uma URL https://')).toBeVisible();
  await expect(page.getByLabel('Endereço')).toBeFocused();
});

test('perfil alterado em outra aba: 409 com opção de recarregar', async ({ page, context }) => {
  await signUp(page);
  await page.goto('/app/settings/profile');
  await expect(page.getByLabel('Bio')).toBeVisible();

  // outra aba salva primeiro
  const other = await context.newPage();
  await other.goto('/app/settings/profile');
  await other.getByLabel('Bio').fill('Salvo na outra aba.');
  await other.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(other.getByText('Perfil salvo.')).toBeVisible();

  await page.getByLabel('Bio').fill('Edição em cima de dado velho.');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText(/O perfil foi alterado em outra aba/)).toBeVisible();

  await page.getByRole('button', { name: 'Recarregar dados do servidor' }).click();
  await expect(page.getByLabel('Bio')).toHaveValue('Salvo na outra aba.');
});

test('troca de handle avisa da reserva de 30 dias e mostra a próxima data', async ({ page }) => {
  const user = await signUp(page);
  await page.goto('/app/settings/account');

  await expect(page.getByText(/fica reservado para você por 30 dias/)).toBeVisible();
  const newHandle = `${user.handle}-novo`;
  await page.getByLabel('Novo handle').fill(newHandle);
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Trocar handle' }).click();

  await expect(page.getByText('Handle trocado.')).toBeVisible();
  await expect(page.getByText(publicAddress(newHandle))).toBeVisible();
  await expect(page.getByText(/Próxima troca permitida a partir de/)).toBeVisible();

  // o handle antigo está em quarentena, mas para o dono aparece como disponível
  await page.getByLabel('Novo handle').fill(user.handle);
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
});

test('troca de senha: senha atual errada aparece no campo; a certa troca', async ({ page }) => {
  const user = await signUp(page);
  await page.goto('/app/settings/account');

  await page.getByLabel('Senha atual', { exact: true }).fill('não-é-a-senha');
  await page.getByLabel('Nova senha', { exact: true }).fill('outra-senha-de-teste-5678');
  await page.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.getByText('Senha atual incorreta.')).toBeVisible();

  await page.getByLabel('Senha atual', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.getByText('Senha trocada. As outras sessões foram encerradas.')).toBeVisible();

  // a sessão atual continua valendo
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
});

test('abas de configurações: Perfil e Conta são rotas; aba inexistente é 404', async ({ page }) => {
  await signUp(page);
  await page.goto('/app/settings');
  await expect(page).toHaveURL('/app/settings/profile');

  const tabs = page.getByRole('navigation', { name: 'Seções das configurações' });
  await expect(tabs.getByRole('link')).toHaveText(['Perfil', 'Conta']);
  await expect(tabs.getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');

  await tabs.getByRole('link', { name: 'Conta' }).click();
  await expect(page).toHaveURL('/app/settings/account');
  await expect(page.getByRole('heading', { name: 'Handle', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Senha', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair de todos os dispositivos' })).toBeVisible();

  await page.goto('/app/settings/plano');
  await expect(page.getByRole('heading', { name: 'Esta página não existe' })).toBeVisible();
});

test('sair de todos os dispositivos, pela aba Conta, encerra a sessão', async ({ page }) => {
  await signUp(page);
  await page.goto('/app/settings/account');
  await page.getByRole('button', { name: 'Sair de todos os dispositivos' }).click();
  await expect(page).toHaveURL('/login');

  await page.goto('/app');
  await expect(page).toHaveURL('/login');
});

test('tema: segue o sistema até a pessoa escolher; a escolha persiste', async ({ page }) => {
  await signUp(page);
  await page.goto('/app/settings/profile');
  const html = page.locator('html');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // sem escolha: sem atributo, vale o prefers-color-scheme (escuro, no E2E)
  await expect(page.getByRole('radio', { name: 'Sistema' })).toBeChecked();
  await expect(html).not.toHaveAttribute('data-theme');
  expect(await background()).toBe('rgb(14, 13, 13)');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await background()).toBe('rgb(243, 242, 242)');

  // escolha explícita ganha do sistema e sobrevive ao reload (cookie lido no servidor)
  await page.getByRole('radio', { name: 'Escuro' }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await background()).toBe('rgb(14, 13, 13)');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Escuro' })).toBeChecked();

  await page.getByRole('radio', { name: 'Claro' }).check();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await background()).toBe('rgb(243, 242, 242)');

  // "Sistema" apaga a escolha
  await page.getByRole('radio', { name: 'Sistema' }).check();
  await expect(html).not.toHaveAttribute('data-theme');
  expect(await page.evaluate(() => document.cookie)).toBe('');
});
