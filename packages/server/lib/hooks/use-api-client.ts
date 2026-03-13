"use client";

import { createContext, useContext } from "react";
import type { ClawRunInstance } from "@clawrun/sdk/browser";

const ApiClientContext = createContext<ClawRunInstance | null>(null);

export const ApiClientProvider = ApiClientContext.Provider;

export function useApiClient(): ClawRunInstance {
  const instance = useContext(ApiClientContext);
  if (!instance) {
    throw new Error("useApiClient must be used within ApiClientProvider");
  }
  return instance;
}
