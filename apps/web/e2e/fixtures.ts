import { randomBytes, randomInt } from 'node:crypto';

import { test as base, expect, type Page } from '@playwright/test';

export const E2E_EMAIL_DOMAIN = 'e2e.casebook.test';

export interface TestUser {
  email: string;
  password: string;
  handle: string;
  displayName: string;
}

export function newUser(): TestUser {
  const id = randomBytes(5).toString('hex');
  return {
    email: `e2e-${id}@${E2E_EMAIL_DOMAIN}`,
    password: 'senha-de-teste-e2e-1234',
    handle: `e2e-${id}`,
    displayName: `Pessoa ${id}`,
  };
}

/**
 * Cada teste sai de um "IP" diferente (a API do E2E roda com TRUST_PROXY=true):
 * os limites de signup e login por IP não vazam de um teste para outro.
 */
export const test = base.extend({
  // O Playwright exige o primeiro parâmetro desestruturado, mesmo sem fixtures.
  // eslint-disable-next-line no-empty-pattern
  extraHTTPHeaders: async ({}, use) => {
    const ip = `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`;
    await use({ 'x-forwarded-for': ip });
  },
});

export { expect };

/** Endereço público como a tela mostra: a base do E2E (`PUBLIC_BASE_URL`) sem o protocolo. */
export function publicAddress(handle: string): string {
  return `localhost:3100/${handle}`;
}

/** Passo 1 do cadastro: cria a conta e para no primeiro passo do onboarding. */
export async function createAccount(page: Page, user = newUser()): Promise<TestUser> {
  await page.goto('/signup');
  await page.getByLabel('Nome de exibição').fill(user.displayName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Senha', { exact: true }).fill(user.password);
  await page.getByLabel('Handle').fill(user.handle);
  await expect(page.getByText('Disponível', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL('/onboarding/role');
  return user;
}

/** Cadastra pela tela, pula os dois passos de onboarding e espera cair no app. */
export async function signUp(page: Page, user = newUser()): Promise<TestUser> {
  await createAccount(page, user);
  await page.getByRole('button', { name: 'Pular por agora' }).click();
  await expect(page).toHaveURL('/onboarding/profile');
  await page.getByRole('button', { name: 'Pular por agora' }).click();
  await expect(page).toHaveURL('/app');
  return user;
}

export async function logOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Conta de / }).click();
  await page.getByRole('menuitem', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL('/login');
}
