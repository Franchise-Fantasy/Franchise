import React from "react";

interface WizardShellProps {
  title: string;
  subtitle?: string;
  steps?: string[];
  currentStep?: number;
  onCancel?: () => void;
  onStepPress?: (index: number) => void;
  aside?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Native passthrough for the web-only desktop wizard frame. The real frame lives
 * in WizardShell.web.tsx and is only ever mounted inside an `isDesktop` branch
 * (always false on native), so iOS/Android render the screen's own mobile layout
 * and never reach this. Kept minimal + hook-free so native bundles are unaffected.
 */
export function WizardShell({ children, footer }: WizardShellProps) {
  return (
    <>
      {children}
      {footer}
    </>
  );
}
