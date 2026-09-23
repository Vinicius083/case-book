import 'reflect-metadata';

import { createApp } from './app.factory.js';
import { type ApiEnv, ENV } from './config/env.js';

const app = await createApp();
const { API_PORT } = app.get<ApiEnv>(ENV);

await app.listen({ port: API_PORT, host: '0.0.0.0' });
