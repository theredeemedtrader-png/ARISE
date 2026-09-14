import type { ReactNode, SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  readonly name:
    | 'overview'
    | 'ideas'
    | 'knowledge'
    | 'trading'
    | 'positions'
    | 'strategy'
    | 'database'
    | 'review'
    | 'analytics'
    | 'health'
    | 'settings'
    | 'search'
    | 'bell'
    | 'plus'
    | 'chevron'
    | 'close'
    | 'command'
    | 'clock'
    | 'layers'
    | 'arrow-up'
    | 'arrow-down'
    | 'panel'
    | 'cursor'
    | 'minus'
    | 'arrow'
    | 'rectangle'
    | 'trend'
    | 'target'
    | 'text';
}

const paths: Record<IconProps['name'], ReactNode> = {
  overview: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9 20v-6h6v6"/></>,
  ideas: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5M8 17h7"/></>,
  knowledge: <><path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H19v17H8.5A3.5 3.5 0 0 0 5 22Z"/><path d="M5 5.5V22M9 7h6M9 11h6"/></>,
  trading: <><path d="M4 18V9M9 15V5M14 20V11M19 14V4"/><path d="M2 18h4M7 9h4M12 15h4M17 8h4"/></>,
  positions: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/><circle cx="17" cy="17" r="1.5"/></>,
  strategy: <><circle cx="5" cy="12" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="12" cy="18" r="2"/><path d="m6.7 10.9 3.6-3.8m3.4 0 3.6 3.8m0 2.2-3.6 3.8m-3.4 0-3.6-3.8"/></>,
  database: <><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></>,
  review: <><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h5M8 16h6"/><path d="m15 12 1.5 1.5L20 10"/></>,
  analytics: <><path d="M4 20V10M9 20V5M14 20v-7M19 20V8"/><path d="M2 20h20"/></>,
  health: <><path d="M4 13h4l2-5 4 9 2-4h4"/><circle cx="12" cy="12" r="10"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 20h4"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  close: <path d="m7 7 10 10M17 7 7 17"/>,
  command: <><path d="M9 6V4a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v16a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2Z"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  'arrow-up': <><path d="M12 19V5M6 11l6-6 6 6"/></>,
  'arrow-down': <><path d="M12 5v14M6 13l6 6 6-6"/></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M8 9h13"/></>,
  cursor: <path d="m5 3 13 8-6 2-3 6Z"/>,
  minus: <path d="M4 12h16"/>,
  arrow: <><path d="M5 19 19 5"/><path d="M12 5h7v7"/></>,
  rectangle: <rect x="4" y="5" width="16" height="14" rx="1"/>,
  trend: <><path d="m4 17 6-7 4 3 6-8"/><circle cx="4" cy="17" r="1"/><circle cx="20" cy="5" r="1"/></>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></>,
  text: <><path d="M5 5h14M12 5v14"/><path d="M8 19h8"/></>,
};

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}
