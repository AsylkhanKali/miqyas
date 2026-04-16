import { create } from "zustand";
import type { BIMModel, Project, Schedule } from "@/types";
import { projectsApi, bimApi, schedulesApi } from "@/services/api";

interface ProjectStore {
  // State
  projects: Project[];
  currentProject: Project | null;
  bimModels: BIMModel[];
  schedules: Schedule[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchProjects: () => Promise<void>;
  fetchProject: (id: string) => Promise<void>;
  createProject: (data: Parameters<typeof projectsApi.create>[0]) => Promise<Project>;
  fetchBIMModels: (projectId: string) => Promise<void>;
  fetchSchedules: (projectId: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProject: null,
  bimModels: [],
  schedules: [],
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const { data } = await projectsApi.list();
      set({ projects: data.items, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  fetchProject: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const { data } = await projectsApi.get(id);
      set({ currentProject: data, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  createProject: async (payload) => {
    set({ loading: true, error: null });
    try {
      const { data } = await projectsApi.create(payload);
      set((s) => ({ projects: [data, ...s.projects], loading: false }));
      return data;
    } catch (e: any) {
      set({ error: e.message, loading: false });
      throw e;
    }
  },

  fetchBIMModels: async (projectId: string) => {
    try {
      const { data } = await bimApi.listModels(projectId);
      set({ bimModels: data });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  fetchSchedules: async (projectId: string) => {
    try {
      const { data } = await schedulesApi.list(projectId);
      set({ schedules: data });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  clearError: () => set({ error: null }),
  reset: () => set({ projects: [], currentProject: null, bimModels: [], schedules: [], loading: false, error: null }),
}));
