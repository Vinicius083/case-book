// Carregado com `node --import` antes do main.ts (mesmo padrão da API).
import { startTelemetry } from './telemetry.js';

export const sdk = startTelemetry('casebook-worker-image');
