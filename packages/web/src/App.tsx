import { useCallback, useState, useEffect } from 'react';
import { useTimelineStore } from './stores/timeline';
import { formatTime } from './utils/format';
import { VideoPreview } from './components/preview/VideoPreview';
import { Timeline } from './components/timeline/Timeline';
import { SegmentEditor } from './components/editor/SegmentEditor';
import { ExportModal } from './components/editor/ExportModal';
import { SaveIndicator } from './components/SaveIndicator';
import { ProjectList } from './components/ProjectList';
import { Logo } from './components/Logo';
import type { UploadResponse } from '@proj/shared';

function App() {
  const {
    project,
    initProject,
    loadFromStorage,
    clearProject,
    undo,
    redo,
    historyIndex,
    history,
    loadProjectFromServer,
    migrateAndSave,
  } = useTimelineStore();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const loaded = loadFromStorage();
      if (loaded) {
        // Migrate existing project to server if needed
        await migrateAndSave();
      } else {
        const url = new URL(window.location.href);
        if (url.searchParams.has('video')) {
          url.searchParams.delete('video');
          window.history.replaceState({}, '', url.toString());
        }
      }
      setIsLoading(false);
    };
    init();
  }, [loadFromStorage, migrateAndSave]);

  const handleProjectSelect = useCallback(async (id: string) => {
    setIsLoading(true);
    const loaded = await loadProjectFromServer(id);
    setIsLoading(false);
    if (!loaded) {
      setUploadError('Failed to load project');
    }
  }, [loadProjectFromServer]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('video', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result: UploadResponse = await response.json();

      if (result.success && result.source) {
        initProject(result.source);
      } else {
        setUploadError(result.error || 'Upload failed');
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [initProject]);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-terminal-muted">Loading...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-4 h-12 border-b border-terminal-border bg-terminal-surface">
          <Logo />
        </header>

        <div className="flex-1 p-6">
          <div className="max-w-5xl mx-auto">
            <ProjectList
              onProjectSelect={handleProjectSelect}
              onNewProject={handleFileSelect}
              isUploading={isUploading}
            />

            {uploadError && (
              <p className="mt-4 text-accent-red text-sm">{uploadError}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex items-center justify-between px-4 h-12 border-b border-terminal-border bg-terminal-surface">
        <div className="flex items-center gap-4">
          <button onClick={clearProject} title="Back to projects" className="hover:opacity-70 transition-opacity"><Logo /></button>
          <div className="w-px h-4 bg-terminal-border" />
          <h1 className="text-terminal-text font-medium text-sm">{project.name}</h1>
          <span className="text-terminal-muted text-sm">
            {formatTime(project.source.duration)} • {project.source.width}x{project.source.height} • {project.source.fps}fps
          </span>
        </div>
        <div className="flex items-center gap-3">
          <SaveIndicator />
          <div className="w-px h-6 bg-terminal-border" />
          <div className="flex items-center gap-1">
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              className="btn p-2 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Undo (Cmd+Z)"
            >
              <UndoIcon />
            </button>
            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              className="btn p-2 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Redo (Cmd+Shift+Z)"
            >
              <RedoIcon />
            </button>
          </div>
          <div className="w-px h-6 bg-terminal-border" />
          <button
            onClick={clearProject}
            className="btn"
            title="Start a new project"
          >
            New
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="btn-primary"
          >
            Export
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0 overflow-hidden">
            <VideoPreview />
          </div>

          <div className="h-64 flex-shrink-0 border-t border-terminal-border">
            <Timeline />
          </div>
        </div>

        <div className="w-80 border-l border-terminal-border overflow-y-auto">
          <SegmentEditor />
        </div>
      </div>

      <footer className="flex items-center justify-between px-4 py-2 border-t border-terminal-border bg-terminal-surface text-sm">
        <span className="text-accent-primary">Ready</span>
        <span className="text-terminal-muted">
          {formatTime(project.timeline.playheadPosition)} / {formatTime(project.timeline.duration)}
        </span>
      </footer>

      {showExport && (
        <ExportModal onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.5 3L1 6.5L4.5 10V7H10C11.657 7 13 8.343 13 10C13 11.657 11.657 13 10 13H7V15H10C12.761 15 15 12.761 15 10C15 7.239 12.761 5 10 5H4.5V3Z" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.5 3L15 6.5L11.5 10V7H6C4.343 7 3 8.343 3 10C3 11.657 4.343 13 6 13H9V15H6C3.239 15 1 12.761 1 10C1 7.239 3.239 5 6 5H11.5V3Z" />
    </svg>
  );
}

export default App;
