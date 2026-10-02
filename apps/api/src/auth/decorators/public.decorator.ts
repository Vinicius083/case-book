import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = Symbol('IS_PUBLIC');

/** Libera a rota (ou o controller inteiro) do AuthGuard global. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
