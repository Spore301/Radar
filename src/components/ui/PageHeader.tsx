import React from 'react';

interface PageHeaderProps {
  /** Mono uppercase eyebrow naming the kind of page or its state ("Session · saved 2h ago"). */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="flex flex-col gap-1 min-w-0">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.8px] text-ink [text-wrap:balance]">{title}</h1>
        {description && <p className="text-body-sm text-body max-w-[70ch]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">{actions}</div>}
    </header>
  );
}
