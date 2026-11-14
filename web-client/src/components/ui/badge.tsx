import * as React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | 'default'
    | 'secondary'
    | 'outline'
    | 'destructive'
    | 'sky'
    | 'amber'
    | 'emerald'
    | 'muted';
}

const badgeVariants: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-primary text-primary-foreground border-transparent',
  secondary: 'bg-secondary text-secondary-foreground border-border',
  outline: 'border-border text-foreground bg-transparent',
  destructive: 'bg-destructive/15 text-destructive border-destructive/30',
  sky: 'bg-primary/15 text-primary border-primary/30',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  muted: 'bg-muted text-muted-foreground border-border',
};

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium leading-none tracking-tight transition-colors select-none',
        badgeVariants[variant],
        className
      )}
      {...props}
    />
  );
}
