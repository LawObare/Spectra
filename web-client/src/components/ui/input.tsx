import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-8 w-full rounded-sm border border-input bg-background px-2.5 py-1 text-xs text-foreground font-mono tabular-nums',
          'placeholder:text-muted-foreground placeholder:font-sans transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
