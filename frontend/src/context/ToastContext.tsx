'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextType {
  addToast: (toast: Omit<ToastItem, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    ({ type, title, message }: Omit<ToastItem, 'id'>) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, type, title, message }]);

      setTimeout(() => {
        removeToast(id);
      }, 5000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}

      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => {
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl shadow-2xl border backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 ${
                toast.type === 'success'
                  ? 'bg-slate-900/95 border-emerald-500/40 text-emerald-200'
                  : toast.type === 'error'
                  ? 'bg-slate-900/95 border-rose-500/40 text-rose-200'
                  : 'bg-slate-900/95 border-indigo-500/40 text-indigo-200'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" />}
                {toast.type === 'info' && <Info className="w-5 h-5 text-indigo-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-100">{toast.title}</p>
                {toast.message && (
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed break-words">{toast.message}</p>
                )}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
