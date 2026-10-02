import type { ReactNode } from 'react';

interface ProfileFrameProps {
  title: string;
  /** Linha sob o título: o endereço público, ou uma frase. */
  children: ReactNode;
}

/**
 * Quadro em 2.39:1 com marcas de área segura, como um visor de câmera: mostra
 * como o nome vai aparecer na abertura do portfólio. Decorativo para leitores de
 * tela — o endereço do perfil também aparece em texto junto ao campo de handle.
 */
export function ProfileFrame({ title, children }: ProfileFrameProps) {
  return (
    <figure aria-hidden className="w-full max-w-3xl">
      <div className="relative flex aspect-[2.39/1] flex-col justify-end overflow-hidden border border-divider bg-black p-[6%]">
        {(
          [
            'top-[5%] left-[3%] border-t border-l',
            'top-[5%] right-[3%] border-t border-r',
            'bottom-[5%] left-[3%] border-b border-l',
            'bottom-[5%] right-[3%] border-b border-r',
          ] as const
        ).map((corner) => (
          <span key={corner} className={`absolute size-[4%] border-fg/40 ${corner}`} />
        ))}
        <p className="font-heading text-[clamp(1.5rem,4.2vw,3.5rem)] leading-[1.02] font-bold break-words text-fg">
          {title}
        </p>
        <p className="mt-[2%] truncate text-[clamp(0.8rem,1.3vw,1.05rem)] text-muted">{children}</p>
      </div>
    </figure>
  );
}
