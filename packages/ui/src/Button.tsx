import * as React from "react";
import { colors, radius, typography } from "./tokens";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

/** Furlpay primary/secondary pill button. */
export function Button({ variant = "primary", style, children, ...rest }: ButtonProps) {
  const base: React.CSSProperties = {
    padding: "14px 20px",
    borderRadius: radius.pill,
    border: variant === "secondary" ? `1px solid ${colors.surfaceMuted}` : "none",
    background: variant === "primary" ? colors.accent : colors.surface,
    color: colors.textPrimary,
    fontWeight: 600,
    fontFamily: typography.fontFamily,
    fontSize: 16,
    cursor: "pointer",
  };
  return (
    <button style={{ ...base, ...style }} {...rest}>
      {children}
    </button>
  );
}
