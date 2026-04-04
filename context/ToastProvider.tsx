import { Toast, type ToastType } from '@/components/ui/Toast';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface ToastState {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

/** Imperative ref for showing toasts outside the React tree (e.g. MutationCache). */
export const globalToastRef: { current: ((type: ToastType, message: string) => void) | null } = {
  current: null,
};

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    setToast({ id: ++nextId, type, message, duration });
  }, []);

  // Wire up the global ref so MutationCache can show toasts imperatively
  const showRef = useRef(showToast);
  showRef.current = showToast;
  useEffect(() => {
    globalToastRef.current = (type, message) => showRef.current(type, message);
    return () => { globalToastRef.current = null; };
  }, []);

  const handleDismiss = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Toast
          key={toast.id}
          type={toast.type}
          message={toast.message}
          duration={toast.duration}
          onDismiss={handleDismiss}
        />
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
