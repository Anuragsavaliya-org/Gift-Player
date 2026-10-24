import type { Toast } from '../useToasts';

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>⚠ {t.text}</div>
      ))}
    </div>
  );
}
