export interface PasswordStrength {
  /** 0 (vazia) a 4 (forte). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

const LABELS = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'] as const;

/**
 * Indicador simples, só para orientar: comprimento pesa mais que variedade de
 * caracteres. A regra de verdade (10 a 128 caracteres) é a do schema.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password === '') return { score: 0, label: LABELS[0] };

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\dA-Za-z]/].filter((re) => re.test(password)).length;
  let points = 0;
  if (password.length >= 10) points += 1;
  if (password.length >= 14) points += 1;
  if (password.length >= 20) points += 1;
  if (classes >= 3) points += 1;
  // Uma letra repetida ou sequência óbvia não fica forte só por ser longa.
  if (new Set(password).size < 6) points = Math.min(points, 1);

  const score = Math.max(1, Math.min(4, points)) as 1 | 2 | 3 | 4;
  return { score, label: LABELS[score] };
}
