import { ReconciliationStatusType } from '../types';

interface StatusBadgeProps {
  status: ReconciliationStatusType;
  text?: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({
  status,
  text,
  size = 'md',
}: StatusBadgeProps) {
  const displayText = text || status;

  // Size classes for the badge
  const sizeClasses =
    size === 'sm'
      ? 'px-3.5 py-1.5 text-sm font-bold gap-2'
      : 'px-4 py-2 text-base font-bold gap-2';

  // Size for the dot
  const dotSize = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3';

  // Default colors
  let colorClasses =
    'bg-slate-50 text-slate-700 border-slate-200';
  let dotClass = 'bg-slate-400';

  switch (status) {
    case 'BALANCED':
      colorClasses =
        'bg-emerald-50 text-emerald-800 border-emerald-200';
      dotClass = 'bg-emerald-500';
      break;

    case 'SHORT':
      colorClasses =
        'bg-rose-50 text-rose-800 border-rose-200';
      dotClass = 'bg-rose-500';
      break;

    case 'EXCESS':
      colorClasses =
        'bg-blue-50 text-blue-800 border-blue-200';
      dotClass = 'bg-blue-500';
      break;

    case 'PENDING':
    default:
      colorClasses =
        'bg-amber-50 text-amber-800 border-amber-200';
      dotClass = 'bg-amber-500';
      break;
  }

  return (
    <span
      id={`reconciliation-status-${status.toLowerCase()}`}
      className={`inline-flex items-center whitespace-nowrap rounded-full border-2 ${sizeClasses} ${colorClasses}`}
    >
      <span
        className={`inline-block shrink-0 rounded-full ${dotSize} ${dotClass}`}
      />
      <span className="leading-none">{displayText}</span>
    </span>
  );
}