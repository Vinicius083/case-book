import { createAccount, expect, logOut, newUser, publicAddress, signUp, test } from './fixtures';

test('cadastro em 3 passos: conta, papel e perfil, e cai no app shell', async ({ page }) => {
  const user = newUser();

  // passo 1: a conta
  await page.goto('/signup');
  await expect(page.getByText('1 de 3').first()).toBeVisible();
  await page.getByLabel('Nome de exibição').fill(user.displayName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill(user.password);

  // checagem de handle em tempo real: reservado tem texto próprio
  await page.getByLabel('Handle').fill('admin');
  await expect(page.getByText(/^Reservado:/)).toBeVisible();
  await page.getByLabel('Handle').fill(user.handle.toUpperCase());
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await expect(page.getByText(publicAddress(user.handle)).first()).toBeVisible();

  await page.getByRole('button', { name: 'Continuar' }).click();

  // passo 2: papel na produção, já com sessão
  await expect(page).toHaveURL('/onboarding/role');
  await expect(page.getByText('2 de 3')).toBeVisible();
  await page.getByRole('button', { name: /^Cor/ }).click();
  await expect(page.getByRole('button', { name: /^Cor/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1 de 3 selecionados')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // passo 3: perfil, com o papel do passo anterior e o preview ao lado
  await expect(page).toHaveURL('/onboarding/profile');
  await expect(page.getByText('3 de 3 — seu perfil')).toBeVisible();
  const preview = page.getByRole('region', { name: 'Preview do perfil público' });
  await expect(preview.getByText(publicAddress(user.handle))).toBeVisible();
  await expect(preview.getByRole('heading', { name: user.displayName })).toBeVisible();
  await page.getByLabel('Bio').fill('Colorista com base em SP.');
  await expect(preview.getByText('Colorista com base em SP.')).toBeVisible();
  await page.getByLabel('Fuso de trabalho').fill('sao paulo');
  await page.getByRole('option', { name: /America\/Sao Paulo/ }).click();
  await page.getByRole('switch', { name: 'Disponível para freelance' }).click();
  await expect(preview.getByText('Disponível para freelance')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar e entrar' }).click();

  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Projetos' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Biblioteca de mídia' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^Perfil público/ })).toHaveAttribute(
    'href',
    `/${user.handle}`,
  );
  await expect(nav.getByRole('link', { name: 'Configurações' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Conta de ${user.displayName}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo projeto' })).toBeDisabled();
  await expect(page.getByText('Chega na próxima versão.')).toBeVisible();

  // o que foi salvo no onboarding aparece no perfil público
  await page.goto(`/${user.handle}`);
  await expect(page.getByRole('heading', { name: user.displayName, level: 1 })).toBeVisible();
  await expect(page.getByText('Colorista com base em SP.')).toBeVisible();
  await expect(page.getByText('Disponível para freelance')).toBeVisible();
  await expect(page.getByText('GMT-3')).toBeVisible();
});

test('onboarding pendente: o app manda para o passo que falta; pular encerra', async ({ page }) => {
  await createAccount(page);

  // sem papel escolhido, qualquer rota do app volta ao passo do papel
  await page.goto('/app/settings/profile');
  await expect(page).toHaveURL('/onboarding/role');

  await page.getByRole('button', { name: 'Pular por agora' }).click();
  await expect(page).toHaveURL('/onboarding/profile');
  await page.getByRole('button', { name: 'Pular por agora' }).click();
  await expect(page).toHaveURL('/app');

  // concluído (pulando): o onboarding não abre mais
  await page.goto('/onboarding/role');
  await expect(page).toHaveURL('/app');
});

test('/u/:handle redireciona (308) para /:handle; rota do site não vira perfil', async ({
  page,
  request,
}) => {
  const user = await signUp(page);

  const legacy = await request.get(`/u/${user.handle}`, { maxRedirects: 0 });
  expect(legacy.status()).toBe(308);
  expect(legacy.headers()['location']).toBe(`/${user.handle}`);

  await page.goto(`/u/${user.handle}`);
  await expect(page).toHaveURL(`/${user.handle}`);
  await expect(page.getByRole('heading', { name: user.displayName, level: 1 })).toBeVisible();

  const missing = await request.get(`/${newUser().handle}`);
  expect(missing.status()).toBe(404);
});

test('logout, depois login volta para a rota do ?next=', async ({ page }) => {
  const user = await signUp(page);
  await logOut(page);

  // sem sessão, a rota protegida manda para o login guardando o destino
  await page.goto('/app/settings/profile');
  await expect(page).toHaveURL('/login?next=%2Fapp%2Fsettings%2Fprofile');

  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL('/app/settings/profile');
  await expect(page.getByRole('heading', { name: 'Configurações', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Nome de exibição')).toHaveValue(user.displayName);
});

test('?next= para fora do site é ignorado', async ({ page }) => {
  const user = await signUp(page);
  await logOut(page);

  await page.goto('/login?next=//evil.example/app');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL('/app');
});

test('recarregar dentro do app mantém a sessão, sem token em storage', async ({
  page,
  context,
}) => {
  await signUp(page);

  await page.reload();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();

  // o access token vive só em memória
  const storage = await page.evaluate(() => ({
    local: window.localStorage.length,
    session: window.sessionStorage.length,
    cookie: document.cookie,
  }));
  expect(storage).toEqual({ local: 0, session: 0, cookie: '' });

  // o refresh token só existe como cookie HttpOnly, restrito a /api/auth
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === 'cb_refresh')).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/api/auth',
  });
  expect(cookies.find((cookie) => cookie.name === 'cb_session')).toMatchObject({
    httpOnly: true,
    value: '1',
    path: '/',
  });
});

test('erros da API aparecem de forma legível', async ({ page }) => {
  const user = await signUp(page);
  await logOut(page);

  // 401: mesma mensagem para email inexistente e senha errada, foco de volta na senha
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada-1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Email ou senha inválidos')).toBeVisible();
  await expect(page.getByLabel('Senha', { exact: true })).toBeFocused();

  // 429: depois de 5 falhas, a tela diz quanto esperar
  for (let attempt = 2; attempt <= 5; attempt++) {
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(
    page.getByText(/^Muitas tentativas\. Tente de novo em 1[45] minutos\.$/),
  ).toBeVisible();

  // 409: email já cadastrado aparece no campo de email, com foco nele
  const other = newUser();
  await page.goto('/signup');
  await page.getByLabel('Nome de exibição').fill(other.displayName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill(other.password);
  await page.getByLabel('Handle').fill(other.handle);
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Este email já está em uso.')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeFocused();

  // validação local: senha curta não chega a ser enviada
  await page.getByLabel('Senha', { exact: true }).fill('curta');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('A senha precisa ter ao menos 10 caracteres')).toBeVisible();
});
