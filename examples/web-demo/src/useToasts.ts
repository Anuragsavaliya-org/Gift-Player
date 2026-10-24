import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
}

/** A tiny toast list: `push(text)` shows a message for a few seconds. */
export function useToasts(): { toasts: Toast[]; push: (text: string) => void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return { toasts, push };
}
