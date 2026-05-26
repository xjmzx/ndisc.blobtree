import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface SectionProps {
  title: ReactNode;
  icon?: ReactNode;
  /** Optional right-side header content (chips, mini-controls). */
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  /**
   * Click handler for the header bar — when provided, the header reads
   * as interactive (cursor + dim-on-hover) and triggers this callback.
   * Used by collapsible panels: caller flips an `expanded` flag and
   * passes `false` as children to omit the body entirely.
   */
  onTitleClick?: () => void;
}

export function Section({
  title,
  icon,
  right,
  children,
  className,
  contentClassName,
  onTitleClick,
}: SectionProps) {
  const hasBody = children != null && children !== false;
  return (
    <section
      className={cn(
        "rounded-xl bg-panel border border-surface/60 shadow-md",
        hasBody ? "p-4 flex flex-col gap-3" : "px-4 py-2 flex flex-col",
        className,
      )}
    >
      <header
        onClick={onTitleClick}
        title={onTitleClick ? "Click the header to expand or collapse" : undefined}
        className={cn(
          "flex items-center gap-2 text-accent font-semibold shrink-0",
          onTitleClick &&
            "cursor-pointer hover:opacity-70 transition-opacity select-none",
        )}
      >
        {icon}
        <h2 className="text-sm tracking-wide uppercase">{title}</h2>
        {right && <div className="ml-auto text-fg/80">{right}</div>}
      </header>
      {hasBody && (
        <div className={cn("text-sm text-fg/90", contentClassName)}>{children}</div>
      )}
    </section>
  );
}
