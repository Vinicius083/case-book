import { expect, logOut, newUser, signUp, test } from './fixtures';

test('cadastro cai no app shell', async ({ page }) => {
  const user = newUser();

  await page.goto('/signup');
  await page.getByLabel('Nome de exibição').fill(user.displayName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);

  // checagem de handle em tempo real: reservado tem texto próprio
  await page.getByLabel('Handle').fill('admin');
  await expect(page.getByText(/^Reservado:/)).toBeVisible();
  await page.getByLabel('Handle').fill(user.handle.toUpperCase());
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await expect(page.getByText(`casebook.app/u/${user.handle}`).first()).toBeVisible();

  await page.getByRole('button', { name: 'Criar conta' }).click();

  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: 'Projetos', level: 1 })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Projetos' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Biblioteca de mídia' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Perfil' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Conta de ${user.displayName}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Novo projeto' })).toBeDisabled();
  await expect(page.getByText('Chega na próxima versão.')).toBeVisible();
});

test('logout, depois login volta para a rota do ?next=', async ({ page }) => {
  const user = await signUp(page);
  await logOut(page);

  // sem sessão, a rota protegida manda para o login guardando o destino
  await page.goto('/app/settings/profile');
  await expect(page).toHaveURL('/login?next=%2Fapp%2Fsettings%2Fprofile');

  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL('/app/settings/profile');
  await expect(page.getByRole('heading', { name: 'Perfil', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Nome de exibição')).toHaveValue(user.displayName);
});

test('?next= para fora do site é ignorado', async ({ page }) => {
  const user = await signUp(page);
  await logOut(page);

  await page.goto('/login?next=//evil.example/app');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha').fill(user.password);
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
  await page.getByLabel('Senha').fill('senha-errada-1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Email ou senha inválidos')).toBeVisible();
  await expect(page.getByLabel('Senha')).toBeFocused();

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
  await page.getByLabel('Senha').fill(other.password);
  await page.getByLabel('Handle').fill(other.handle);
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText('Este email já está em uso.')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeFocused();

  // validação local: senha curta não chega a ser enviada
  await page.getByLabel('Senha').fill('curta');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByText('A senha precisa ter ao menos 10 caracteres')).toBeVisible();
});
