import type { SVGProps } from 'react';

export function UndoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" {...props}>
      <path d="M12 5V2L7 7l5 5V9c3.9 0 7 3.1 7 7s-3.1 7-7 7-7-3.1-7-7h2c0 2.8 2.2 5 5 5s5-2.2 5-5-2.2-5-5-5z" />
    </svg>
  );
}

export function RedoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" {...props}>
      <path d="M12 5V2l5 5-5 5V9c-3.9 0-7 3.1-7 7s3.1 7 7 7 7-3.1 7-7h-2c0 2.8-2.2 5-5 5s-5-2.2-5-5 2.2-5 5-5z" />
    </svg>
  );
}

export function ResetIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" {...props}>
      <path d="M12 4V1L8 5l4 4V6a6 6 0 110 12 6 6 0 01-6-6H4a8 8 0 108-8z" />
    </svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" {...props}>
      <path d="M3 6h18v2H3V6zm2 3h14l-1 11a2 2 0 01-2 2H6a2 2 0 01-2-2L3 9h2zm5 2v7h2v-7H10zm4 0v7h2v-7h-2zM9 4h6l1 1h4v2H4V5h4l1-1z" />
    </svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" {...props}>
      <path d="M11 5v6H5v2h6v6h2v-6h6v-2h-6V5h-2z" />
    </svg>
  );
}
