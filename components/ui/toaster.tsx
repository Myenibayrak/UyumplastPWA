"use client";

import { useToast } from "@/hooks/use-toast";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg border p-4 shadow-lg transition-all ${
            t.variant === "destructive"
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "border-border bg-background text-foreground"
          }`}
        >
          {t.title && <p className="text-sm font-semibold">{t.title}</p>}
          {t.description && <p className="text-sm opacity-90">{t.description}</p>}
        </div>
      ))}
    </div>
  );
}
