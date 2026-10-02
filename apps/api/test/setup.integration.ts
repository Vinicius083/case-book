import 'reflect-metadata';

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Testes de integração usam a infra do compose (pnpm infra:up) com o .env da raiz.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
