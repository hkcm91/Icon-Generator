import { useState, type ReactNode } from 'react';

/** Closed editors do not need hundreds of live form controls. */
export default function DeferredDetails({ summary, className, children }: {
  summary: ReactNode; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <details className={className} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{summary}</summary>
    {open && children}
  </details>;
}
