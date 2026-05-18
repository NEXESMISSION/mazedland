import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] font-bold tracking-tight transition-[background,box-shadow,border-color,color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        primary:
          "text-white bg-[var(--gold)] shadow-[var(--shadow-gold)] hover:bg-[var(--gold-bright)] hover:shadow-[0_8px_24px_-6px_rgba(30,58,138,0.35)]",
        secondary:
          "bg-[var(--surface-2)] text-foreground border border-[var(--border)] hover:bg-[var(--surface-3)] hover:border-[var(--gold-soft)]",
        outline:
          "border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold-faint)]",
        ghost: "text-foreground hover:bg-[var(--surface-2)]",
        danger:
          "bg-[var(--danger)] text-white hover:bg-red-600 shadow-[0_4px_14px_-4px_rgba(220,38,38,0.30)]",
        link:
          "text-[var(--gold)] underline-offset-4 hover:underline p-0 font-semibold",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-5 text-base",
        lg: "h-13 px-7 text-lg",
        xl: "h-14 px-8 text-lg",
        icon: "h-10 w-10",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, fullWidth, className }))}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
