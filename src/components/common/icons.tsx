/**
 * Local inline SVG icon set (doc/UI_DESIGN_REVIEW_TRANSPORT_AND_NAV.md §2).
 * Renders identically across browsers/OSes, unlike Unicode glyphs which are
 * drawn by the system font and can differ in shape, weight, and baseline.
 */

interface IconProps {
  className?: string;
}

const VIEW_BOX = '0 0 24 24';

export function PlayIcon({ className }: IconProps) {
  return (
    <svg className={className} width={18} height={18} viewBox={VIEW_BOX} fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg className={className} width={18} height={18} viewBox={VIEW_BOX} fill="currentColor" aria-hidden="true">
      <rect x={6} y={5} width={4} height={14} rx={1} />
      <rect x={14} y={5} width={4} height={14} rx={1} />
    </svg>
  );
}
