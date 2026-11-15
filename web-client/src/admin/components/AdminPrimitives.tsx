import React from 'react';
import { cn } from '../../lib/utils';

/* -------------------------------------------------------------------------- */
/* Clean 16x16 Stroke Icons (zero external package churn)                     */
/* -------------------------------------------------------------------------- */
type IconProps = { className?: string };

export const IconSliders: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="2" y1="14" x2="6" y2="14" />
    <line x1="10" y1="8" x2="14" y2="8" />
    <line x1="18" y1="16" x2="22" y2="16" />
  </svg>
);

export const IconDatabase: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
  </svg>
);

export const IconScan: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="7" x2="12" y2="9" />
    <line x1="12" y1="15" x2="12" y2="17" />
  </svg>
);

export const IconNetwork: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

export const IconAlert: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const IconSearch: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-3.5 h-3.5', className)}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const IconCpu: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <line x1="9" y1="1" x2="9" y2="4" />
    <line x1="15" y1="1" x2="15" y2="4" />
    <line x1="9" y1="20" x2="9" y2="23" />
    <line x1="15" y1="20" x2="15" y2="23" />
    <line x1="20" y1="9" x2="23" y2="9" />
    <line x1="20" y1="14" x2="23" y2="14" />
    <line x1="1" y1="9" x2="4" y2="9" />
    <line x1="1" y1="14" x2="4" y2="14" />
  </svg>
);

export const IconLayers: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

export const IconActivity: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

export const IconCheckCircle: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

export const IconCompass: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

export const IconArrowLeft: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-3.5 h-3.5', className)}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

export const IconMenu: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

export const IconX: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn('w-4 h-4', className)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/* -------------------------------------------------------------------------- */
/* Clean Dashboard Primitives (Dash1-inspired clarity in Spectra palette)     */
/* -------------------------------------------------------------------------- */

interface AdminPageHeaderProps {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  className?: string;
}

export const AdminPageHeader: React.FC<AdminPageHeaderProps> = ({
  title,
  subtitle,
  actions,
  className,
}) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
    <div className="min-w-0">
      <h2 className="text-xl sm:text-[22px] font-semibold tracking-tight text-foreground leading-tight">
        {title}
      </h2>
      <p className="text-xs sm:text-[13px] text-muted-foreground mt-1 leading-relaxed">
        {subtitle}
      </p>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

interface AdminKpiCardProps {
  label: string;
  value: React.ReactNode;
  delta?: string;
  deltaTone?: 'emerald' | 'sky' | 'amber' | 'muted';
  icon: React.ReactNode;
  className?: string;
}

export const AdminKpiCard: React.FC<AdminKpiCardProps> = ({
  label,
  value,
  delta,
  deltaTone = 'muted',
  icon,
  className,
}) => {
  const deltaColor =
    deltaTone === 'emerald'
      ? 'text-emerald-400'
      : deltaTone === 'sky'
        ? 'text-sky-400'
        : deltaTone === 'amber'
          ? 'text-amber-400'
          : 'text-muted-foreground';

  return (
    <div
      className={cn(
        'h-full rounded-xl border border-white/[0.075] bg-card px-4 py-3.5 flex items-center justify-between gap-3 transition-colors hover:border-white/[0.12]',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-muted-foreground truncate">{label}</div>
        <div className="text-xl xl:text-2xl font-semibold tracking-tight tabular-nums text-foreground mt-1 leading-tight truncate">
          {value}
        </div>
        {delta && <div className={cn('text-[11px] mt-1.5 truncate', deltaColor)}>{delta}</div>}
      </div>
      <div className="w-10 h-10 rounded-lg border border-white/[0.08] bg-white/[0.03] flex items-center justify-center text-muted-foreground shrink-0">
        {icon}
      </div>
    </div>
  );
};

interface SegmentedProgressBarProps {
  percent: number;
  tone?: 'sky' | 'emerald' | 'amber';
  showLabel?: boolean;
  className?: string;
}

export const SegmentedProgressBar: React.FC<SegmentedProgressBarProps> = ({
  percent,
  tone = 'sky',
  showLabel = true,
  className,
}) => {
  const clamped = Math.max(0, Math.min(100, percent));
  const activeTicks = Math.round((clamped / 100) * 10);
  const fillClass =
    tone === 'emerald'
      ? 'bg-emerald-400'
      : tone === 'amber'
        ? 'bg-amber-400'
        : 'bg-primary';

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <div className="inline-flex items-center gap-[3px]" aria-label={`${Math.round(clamped)}%`}>
        {Array.from({ length: 10 }, (_, idx) => (
          <span
            key={idx}
            className={cn(
              'w-[3px] h-3.5 rounded-full transition-colors',
              idx < activeTicks ? fillClass : 'bg-white/[0.09]'
            )}
          />
        ))}
      </div>
      {showLabel && (
        <span className="text-xs font-medium tabular-nums text-foreground">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  );
};

interface AdminStatusPillProps {
  tone?: 'emerald' | 'sky' | 'amber' | 'muted' | 'rose';
  children: React.ReactNode;
  className?: string;
}

export const AdminStatusPill: React.FC<AdminStatusPillProps> = ({
  tone = 'muted',
  children,
  className,
}) => {
  const toneClasses = {
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    sky: 'border-primary/30 bg-primary/10 text-sky-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
    muted: 'border-white/[0.09] bg-white/[0.03] text-muted-foreground',
  }[tone];

  const dotClasses = {
    emerald: 'bg-emerald-400',
    sky: 'bg-primary',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    muted: 'bg-muted-foreground',
  }[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-tight whitespace-nowrap',
        toneClasses,
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotClasses)} />
      {children}
    </span>
  );
};

interface AdminSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const AdminSearchInput: React.FC<AdminSearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  className,
}) => (
  <div className={cn('relative', className)}>
    <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-8 w-full rounded-lg border border-white/[0.08] bg-background/80 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/60 transition-colors"
    />
  </div>
);
