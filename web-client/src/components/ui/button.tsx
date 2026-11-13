import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | 'sky';
  size?: 'default' | 'sm' | 'xs' | 'lg' | 'icon' | 'icon-sm';
}

const variantStyles: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-none border border-transparent',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 border border-transparent',
  outline: 'border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border',
  ghost: 'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent',
  link: 'text-primary underline-offset-4 hover:underline bg-transparent border-transparent p-0',
  sky: 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20',
};

const sizeStyles: Record<NonNullable<ButtonProps['size']>, string> = {
  default: 'h-8 px-3 text-xs',
  sm: 'h-7 px-2.5 text-xs',
  xs: 'h-6 px-2 text-[11px]',
  lg: 'h-9 px-4 text-sm',
  icon: 'h-7 w-7 p-0 flex items-center justify-center shrink-0',
  'icon-sm': 'h-6 w-6 p-0 flex items-center justify-center shrink-0',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center font-sans font-medium whitespace-nowrap rounded-sm transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0',
          'disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
