/**
 * Global app settings — persisted to localStorage.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsStore {
  useFakeData: boolean;
  setUseFakeData: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      useFakeData: false,
      setUseFakeData: (v) => set({ useFakeData: v }),
    }),
    { name: "miqyas-settings" },
  ),
);
