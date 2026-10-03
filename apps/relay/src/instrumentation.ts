// Carregado com `node --import` antes do main.ts (mesmo padrão da API e do worker).
import { startTelemetry } from './telemetry.js';

export const sdk = startTelemetry('casebook-relay');
