import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const getToastStyles = (type: ToastType) => {
    switch (type) {
      case 'success': return 'bg-board-emerald text-white';
      case 'error': return 'bg-board-crimson text-white';
      case 'info': return 'bg-board-navy text-board-parchment';
    }
  };

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✗';
      case 'info': return 'ℹ';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Toast container - top-right */}
      <div className="fixed top-4 right-4 z-[9999] space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.9 }}
              className={`pointer-events-auto px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 min-w-[280px] ${getToastStyles(toast.type)}`}
            >
              <span className="text-lg font-bold">{getIcon(toast.type)}</span>
              <span className="text-sm font-medium flex-1">{toast.message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="opacity-60 hover:opacity-100 text-lg leading-none"
              >
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}
