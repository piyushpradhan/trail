import React from 'react';

const props = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const RefreshIcon = () => (
  <svg {...props}>
    <path d="M2 8a6 6 0 0 1 10.5-3.97L14 6" />
    <path d="M14 2v4h-4" />
    <path d="M14 8a6 6 0 0 1-10.5 3.97L2 10" />
    <path d="M2 14v-4h4" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...props}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const ExternalIcon = () => (
  <svg {...props}>
    <path d="M9 3h4v4" />
    <path d="M13 3 7 9" />
    <path d="M11 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3" />
  </svg>
);

export const SnoozeIcon = () => (
  <svg {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 2" />
  </svg>
);

export const TrashIcon = () => (
  <svg {...props}>
    <path d="M3 5h10" />
    <path d="M5 5V3h6v2" />
    <path d="M4 5v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V5" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...props}>
    <path d="M3 8l3 3 7-7" />
  </svg>
);

export const SettingsIcon = () => (
  <svg {...props}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1v2M8 13v2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M1 8h2M13 8h2M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
  </svg>
);
