'use client';

import { useMemo } from 'react';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Switch } from '@/components/ui/switch';
import { timeZoneOptions } from '@/lib/time-zones';

// Campos de perfil que aparecem tanto no onboarding quanto nas configurações.

interface TimeZoneSelectProps {
  id: string;
  /** `''` = sem fuso definido. */
  value: string;
  onChange: (value: string) => void;
  'aria-invalid'?: true | undefined;
  'aria-describedby'?: string;
}

/** Fuso de trabalho: select com busca sobre os timezones IANA. */
export function TimeZoneSelect(props: TimeZoneSelectProps) {
  const options = useMemo(timeZoneOptions, []);
  return (
    <Combobox
      options={options}
      emptyLabel="Sem fuso definido"
      placeholder="Busque por cidade"
      {...props}
    />
  );
}

interface FreelanceSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function FreelanceSwitch({ checked, onChange }: FreelanceSwitchProps) {
  return (
    <Card className="flex items-center justify-between gap-5">
      <div>
        <CardTitle id="freelance-label" className="text-[1.0625rem]">
          Disponível para freelance
        </CardTitle>
        <CardDescription id="freelance-hint">Mostra um selo no seu perfil público</CardDescription>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-labelledby="freelance-label"
        aria-describedby="freelance-hint"
      />
    </Card>
  );
}
