import { useEffect, useState } from 'react';
import { useProjectsStore } from '../stores/projects';
import type { ProjectMetadata } from '@proj/shared';

interface ProjectListProps {
  onProjectSelect: (id: string) => void;
  onNewProject: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isUploading: boolean;
}

export function ProjectList({ onProjectSelect, onNewProject, isUploading }: ProjectListProps) {
  const { projects, isLoading, error, fetchProjects, deleteProject } = useProjectsStore();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Reset confirm state when clicking elsewhere
  useEffect(() => {
    if (!confirmDeleteId) return;
    const reset = () => setConfirmDeleteId(null);
    const timer = setTimeout(reset, 3000);
    window.addEventListener('click', reset);
    return () => { clearTimeout(timer); window.removeEventListener('click', reset); };
  }, [confirmDeleteId]);

  const handleDelete = async (e: React.MouseEvent, project: ProjectMetadata) => {
    e.stopPropagation();
    if (confirmDeleteId !== project.id) {
      setConfirmDeleteId(project.id);
      return;
    }
    setConfirmDeleteId(null);
    setDeletingId(project.id);
    await deleteProject(project.id);
    setDeletingId(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      // Synthesize a change event-like call
      const input = document.createElement('input');
      input.type = 'file';
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      onNewProject({ target: input } as React.ChangeEvent<HTMLInputElement>);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="text-terminal-muted text-sm py-12 text-center">
        Loading projects...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-accent-red text-sm py-12 text-center">
        {error}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* New project card */}
      <label
        className={`panel flex flex-col items-center justify-center cursor-pointer border-dashed transition-colors min-h-[200px] ${
          isDragOver
            ? 'border-accent-primary bg-accent-primary/5'
            : 'border-terminal-border hover:border-accent-primary/50'
        } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept="video/*"
          onChange={onNewProject}
          disabled={isUploading}
          className="hidden"
        />
        {isUploading ? (
          <>
            <svg className="w-8 h-8 text-accent-primary animate-spin mb-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-terminal-muted">Uploading...</span>
          </>
        ) : (
          <>
            <svg className="w-8 h-8 text-terminal-muted mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className="text-sm text-terminal-text font-medium">New Project</span>
            <span className="text-xs text-terminal-muted mt-1">Drop video or click to upload</span>
          </>
        )}
      </label>

      {/* Existing projects */}
      {projects.map((project) => (
        <div
          key={project.id}
          onClick={() => onProjectSelect(project.id)}
          className="panel cursor-pointer hover:border-accent-primary/50 transition-colors group relative overflow-hidden"
        >
          {/* Thumbnail */}
          <div className="aspect-video bg-terminal-bg overflow-hidden">
            {project.thumbnailUrl ? (
              <img
                src={project.thumbnailUrl}
                alt={project.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-terminal-border">
                <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="p-3 flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-terminal-text text-sm font-medium truncate">
                {project.name}
              </h3>
              <div className="text-terminal-muted text-xs mt-0.5">
                {formatDuration(project.duration)} &middot; {formatDate(project.updatedAt)}
              </div>
            </div>

            {/* Delete button */}
            <button
              onClick={(e) => handleDelete(e, project)}
              disabled={deletingId === project.id}
              className={`transition-all p-1 flex-shrink-0 ${
                confirmDeleteId === project.id
                  ? 'opacity-100 text-accent-red'
                  : deletingId === project.id
                    ? 'opacity-100 text-terminal-muted'
                    : 'opacity-0 group-hover:opacity-100 text-terminal-muted hover:text-accent-red'
              }`}
              title={confirmDeleteId === project.id ? 'Click again to confirm' : 'Delete project'}
            >
              {deletingId === project.id ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : confirmDeleteId === project.id ? (
                <span className="text-xs font-medium">Delete?</span>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
