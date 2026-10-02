import { supportedTimeZones } from '@casebook/contracts/profile';

/** Deslocamento atual do fuso em relação ao UTC, como "GMT-3". `undefined` se o runtime não conhece o fuso. */
export function timeZoneOffset(timeZone: string): string | undefined {
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return undefined;
  }
}

/** Opções do seletor de fuso: nome IANA legível e o deslocamento ao lado. */
export function timeZoneOptions(): { value: string; label: string; detail?: string }[] {
  return supportedTimeZones().map((timeZone) => {
    const detail = timeZoneOffset(timeZone);
    return { value: timeZone, label: timeZone.replaceAll('_', ' '), ...(detail && { detail }) };
  });
}
