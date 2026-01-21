import { create } from 'zustand';
import type { ProjectMetadata } from '@proj/shared';

interface ProjectsState {
  projects: ProjectMetadata[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchProjects: () => Promise<void>;
  deleteProject: (id: string) => Promise<boolean>;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch('/api/projects');
      const result = await response.json();

      if (result.success) {
        set({ projects: result.projects, isLoading: false });
      } else {
        set({ error: result.error || 'Failed to fetch projects', isLoading: false });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch projects',
        isLoading: false,
      });
    }
  },

  deleteProject: async (id: string) => {
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
      });
      const result = await response.json();

      if (result.success) {
        // Remove from local state
        set((state) => ({
          projects: state.projects.filter((p) => p.id !== id),
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to delete project:', error);
      return false;
    }
  },
}));
