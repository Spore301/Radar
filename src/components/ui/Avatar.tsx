import React from 'react';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}

/** Hairline circle with the person's image or initials — never a coloured fill. */
export function Avatar({ name, src, size = 32, className = '' }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('');
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} style={style} className={`rounded-full object-cover border border-hairline flex-shrink-0 ${className}`} />;
  }
  return (
    <div
      style={style}
      aria-hidden
      className={`rounded-full bg-hairline-soft border border-hairline text-body font-medium flex items-center justify-center flex-shrink-0 ${className}`}
    >
      {initials || '?'}
    </div>
  );
}
