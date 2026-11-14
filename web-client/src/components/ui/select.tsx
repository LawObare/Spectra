import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  sizeVariant?: 'default' | 'sm' | 'xs';
}

const sizeStyles = {
  default: 'h-8 text-xs pl-2.5 pr-8 py-1',
  sm: 'h-7 text-xs pl-2 pr-7 py-0.5',
  xs: 'h-6 text-[11px] pl-1.5 pr-6 py-0',
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, sizeVariant = 'default', children, ...props }, ref) => {
    const isFullWidth = className?.includes('w-full');
    return (
      <div className={cn('relative inline-flex items-center', isFullWidth && 'w-full')}>
        <select
          ref={ref}
          className={cn(
            'appearance-none rounded-sm border border-input bg-background font-mono text-foreground tabular-nums transition-colors duration-150 cursor-pointer',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-50',
            sizeStyles[sizeVariant],
            className
          )}
          {...props}
        >
          {children}
        </select>
        <div className="pointer-events-none absolute right-2 flex items-center text-muted-foreground">
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1 1L5 5L9 1" />
          </svg>
        </div>
      </div>
    );
  }
);

Select.displayName = 'Select';
