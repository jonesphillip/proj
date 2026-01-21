import { useTimelineStore, type SaveStatus } from '../stores/timeline';

export function SaveIndicator() {
  const saveStatus = useTimelineStore((state) => state.saveStatus);
  const saveError = useTimelineStore((state) => state.saveError);

  const statusConfig: Record<SaveStatus, { text: string; className: string }> = {
    idle: { text: '', className: '' },
    saving: { text: 'Saving...', className: 'text-terminal-muted' },
    saved: { text: 'Saved', className: 'text-accent-primary' },
    error: { text: 'Save failed', className: 'text-accent-red' },
  };

  const config = statusConfig[saveStatus];

  if (saveStatus === 'idle') {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 text-sm ${config.className}`}>
      {saveStatus === 'saving' && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {saveStatus === 'saved' && (
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {saveStatus === 'error' && (
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      )}
      <span>{config.text}</span>
      {saveError && (
        <span className="text-xs opacity-75" title={saveError}>
          (!)
        </span>
      )}
    </div>
  );
}
