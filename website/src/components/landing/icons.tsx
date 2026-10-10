import type { ReactNode } from 'react';

const Icon = ({ children }: { children: ReactNode }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const TreeIcon = () => (
  <Icon>
    <circle cx="12" cy="5" r="2.5" />
    <circle cx="5.5" cy="18" r="2.5" />
    <circle cx="18.5" cy="18" r="2.5" />
    <path d="M12 7.5v4M12 11.5l-5.5 4.2M12 11.5l5.5 4.2" />
  </Icon>
);

export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6l8-3z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </Icon>
);

export const BoltIcon = () => (
  <Icon>
    <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />
  </Icon>
);

export const ShareIcon = () => (
  <Icon>
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="M8.2 10.8l7.6-4.6M8.2 13.2l7.6 4.6" />
  </Icon>
);

export const BitsIcon = () => (
  <Icon>
    <rect x="3" y="6" width="4" height="12" rx="1" />
    <rect x="10" y="6" width="4" height="12" rx="1" />
    <rect x="17" y="6" width="4" height="12" rx="1" />
    <path d="M5 10v4M19 10v4" />
  </Icon>
);

export const EyeOffIcon = () => (
  <Icon>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.6 4.2 9.6 7-.4 1.1-1.2 2.4-2.3 3.6M6.4 6.4C4.4 7.7 3 9.8 2.4 12c1 2.8 4.6 7 9.6 7 1.8 0 3.4-.5 4.8-1.3" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);

export const LayersIcon = () => (
  <Icon>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Icon>
);

export const CodeIcon = () => (
  <Icon>
    <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Icon>
);

export const MigrationIcon = () => (
  <Icon>
    <rect x="3" y="3.5" width="18" height="5" rx="1.5" />
    <rect x="3" y="15.5" width="18" height="5" rx="1.5" />
    <path d="M12 8.5v7M9 12.5l3 3 3-3" />
  </Icon>
);

export const GraphQLIcon = () => (
  <Icon>
    <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5z" />
    <path d="M12 2.5L3.8 16.75h16.4L12 2.5z" />
  </Icon>
);

export const ArrowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const GitHubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
  </svg>
);
