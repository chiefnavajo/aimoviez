'use client';

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

// Toast types
type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Toast icons and colors
const toastConfig: Record<ToastType, { icon: typeof CheckCircle; bgColor: string; iconColor: string }> = {
  success: { icon: CheckCircle, bgColor: 'bg-green-500/10 border-green-500/30', iconColor: 'text-green-500' },
  error: { icon: AlertCircle, bgColor: 'bg-red-500/10 border-red-500/30', iconColor: 'text-red-500' },
  warning: { icon: AlertTriangle, bgColor: 'bg-yellow-500/10 border-yellow-500/30', iconColor: 'text-yellow-500' },
  info: { icon: Info, bgColor: 'bg-cyan-500/10 border-cyan-500/30', iconColor: 'text-cyan-500' },
};

// Generate unique ID
let toastId = 0;
const generateId = () => `toast-${++toastId}`;

// Toast Provider Component
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // FIX: Track timeout IDs in ref to cleanup on unmount
  const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // FIX: Cleanup all timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach(clearTimeout);
      timeoutRefs.current.clear();
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
    // FIX: Clear timeout when toast is manually removed
    const timeoutId = timeoutRefs.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutRefs.current.delete(id);
    }
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = generateId();
    const toast: Toast = { id, type, message, duration };

    setToasts(prev => [...prev, toast]);

    // Auto-remove after duration
    if (duration > 0) {
      // FIX: Track timeout ID for cleanup
      const timeoutId = setTimeout(() => {
        removeToast(id);
        timeoutRefs.current.delete(id);
      }, duration);
      timeoutRefs.current.set(id, timeoutId);
    }
  }, [removeToast]);

  const success = useCallback((message: string, duration?: number) => {
    addToast('success', message, duration);
  }, [addToast]);

  const error = useCallback((message: string, duration?: number) => {
    addToast('error', message, duration);
  }, [addToast]);

  const warning = useCallback((message: string, duration?: number) => {
    addToast('warning', message, duration);
  }, [addToast]);

  const info = useCallback((message: string, duration?: number) => {
    addToast('info', message, duration);
  }, [addToast]);

  const contextValue = useMemo(() => ({ toasts, addToast, removeToast, success, error, warning, info }), [toasts, addToast, removeToast, success, error, warning, info]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

// Toast Container Component
function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

// Individual Toast Item
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const config = toastConfig[toast.type];
  const Icon = config.icon;

  return (
    <div
      className={`
        pointer-events-auto flex items-start gap-3 p-4 rounded-xl border backdrop-blur-lg
        ${config.bgColor}
        animate-slide-in-right
        shadow-lg shadow-black/20
      `}
      role="alert"
    >
      <Icon className={`w-5 h-5 shrink-0 ${config.iconColor}`} />
      <p className="flex-1 text-sm text-white">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="shrink-0 p-1 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4 text-white/60" />
      </button>
    </div>
  );
}

// Hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Add animation to globals.css
// @keyframes slide-in-right {
//   from { transform: translateX(100%); opacity: 0; }
//   to { transform: translateX(0); opacity: 1; }
// }
// .animate-slide-in-right { animation: slide-in-right 0.3s ease-out; }
