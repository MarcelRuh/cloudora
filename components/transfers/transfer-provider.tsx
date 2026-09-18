"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { TransferItem } from "@/lib/transfer";

type TransferContextValue = {
  items: TransferItem[];
  add: (item: TransferItem) => void;
  patch: (id: string, patch: Partial<TransferItem>) => void;
  remove: (id: string) => void;
  finish: (id: string, patch: Partial<TransferItem>, removeAfterMs?: number) => void;
};

const TransferContext = createContext<TransferContextValue | null>(null);

export function TransferProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<TransferItem[]>([]);

  const add = useCallback((item: TransferItem) => {
    setItems((list) => [...list, item]);
  }, []);

  const patch = useCallback((id: string, next: Partial<TransferItem>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const finish = useCallback((id: string, next: Partial<TransferItem>, removeAfterMs = 4000) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...next } : item)));
    if (next.error) return;
    window.setTimeout(() => {
      setItems((list) => list.filter((item) => item.id !== id));
    }, removeAfterMs);
  }, []);

  const value = useMemo(() => ({ items, add, patch, remove, finish }), [items, add, patch, remove, finish]);
  return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>;
}

export function useTransfers(): TransferContextValue {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error("useTransfers braucht TransferProvider");
  return ctx;
}
