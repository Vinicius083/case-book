import { describe, expect, it } from 'vitest';

import { publicAddress } from './public-address';

describe('publicAddress', () => {
  it('mostra o endereço sem protocolo e monta a URL completa', () => {
    expect(publicAddress('https://casebook.com.br', 'ana-lima')).toEqual({
      text: 'casebook.com.br/ana-lima',
      url: 'https://casebook.com.br/ana-lima',
    });
  });

  it('aceita base com barra final e com porta (dev)', () => {
    expect(publicAddress('http://localhost:3000/', 'ana')).toEqual({
      text: 'localhost:3000/ana',
      url: 'http://localhost:3000/ana',
    });
  });
});
