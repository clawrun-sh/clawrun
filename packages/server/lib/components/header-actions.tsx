"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface HeaderActionsContextValue {
  actions: React.ReactNode;
  setActions: (node: React.ReactNode) => void;
}

const HeaderActionsContext = createContext<HeaderActionsContextValue | null>(null);

export function HeaderActionsProvider({ children }: { children: React.ReactNode }) {
  const [actions, setActions] = useState<React.ReactNode>(null);
  return (
    <HeaderActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </HeaderActionsContext.Provider>
  );
}

export function useHeaderActions() {
  const ctx = useContext(HeaderActionsContext);
  if (!ctx) throw new Error("useHeaderActions must be used within HeaderActionsProvider");
  return ctx;
}

export function useSetHeaderActions(node: React.ReactNode) {
  const { setActions } = useHeaderActions();

  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  }, [node, setActions]);
}
