import type { CSSProperties } from 'react';
import clsx from 'clsx';
import type { SimpleIcon } from 'simple-icons';
import styles from './landing.module.css';

// The relative luminance of WCAG
const luminance = (hex: string) => {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

// A brand color with too little contrast on the dark theme, or on the light one, gives way to the color of the text
export function Logo({ icon, brand = false, size = 24 }: { icon: SimpleIcon; brand?: boolean; size?: number }) {
  const l = luminance(icon.hex);
  const style = {
    ...((l + 0.05) / 0.055 >= 2.5 ? { '--brand-dark': `#${icon.hex}` } : {}),
    ...(1.05 / (l + 0.05) >= 1.8 ? { '--brand-light': `#${icon.hex}` } : {}),
  } as CSSProperties;
  return (
    <svg role="img" aria-label={icon.title} viewBox="0 0 24 24" width={size} height={size} className={clsx(styles.logo, brand && styles.logoBrand)} style={style}>
      <path d={icon.path} />
    </svg>
  );
}
