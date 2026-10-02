import Link from 'next/link';

import { cn } from '@/lib/utils';

interface TabsNavProps {
  label: string;
  tabs: readonly { href: string; label: string }[];
  current: string;
}

/** Abas que são rotas: cada uma é um link, e a atual leva `aria-current`. */
export function TabsNav({ label, tabs, current }: TabsNavProps) {
  return (
    <nav aria-label={label}>
      <ul className="flex gap-[1.625rem] overflow-x-auto border-b border-border text-[0.9375rem]">
        {tabs.map((tab) => {
          const active = tab.href === current;
          return (
            <li key={tab.href} className="-mb-px">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block border-b-2 pt-1 pb-3 whitespace-nowrap',
                  active
                    ? 'border-accent text-text'
                    : 'border-transparent text-muted hover:text-text',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
