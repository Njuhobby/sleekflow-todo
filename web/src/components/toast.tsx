import * as Toast from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  variant: "info" | "error";
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

interface ToastApi {
  info: (message: string, opts?: { actionLabel?: string; onAction?: () => void }) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ info: () => {}, error: () => {} });

export const useToast = () => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((item: Omit<ToastItem, "id">) => {
    setToasts((prev) => [...prev.slice(-3), { ...item, id: nextId++ }]);
  }, []);

  const api: ToastApi = {
    info: (message, opts) =>
      push({
        message,
        variant: "info",
        actionLabel: opts?.actionLabel,
        onAction: opts?.onAction,
        // undo-style toasts stay a bit longer (delete → Undo, A5)
        duration: opts?.actionLabel ? 5000 : 3000,
      }),
    error: (message) => push({ message, variant: "error", duration: 5000 }),
  };

  return (
    <ToastContext.Provider value={api}>
      <Toast.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            duration={t.duration}
            className={`toast ${t.variant === "error" ? "toast-error" : ""}`}
            onOpenChange={(open) => {
              if (!open) setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }}
          >
            <Toast.Description>{t.message}</Toast.Description>
            {t.actionLabel && (
              <Toast.Action altText={t.actionLabel} asChild>
                <button className="toast-action" onClick={t.onAction}>
                  {t.actionLabel}
                </button>
              </Toast.Action>
            )}
          </Toast.Root>
        ))}
        <Toast.Viewport className="toast-viewport" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}
