import { useCallback, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { formatTime } from '../../utils/format';
import { SpeedEditor } from './SpeedEditor';
import { ZoomEffectEditor } from './ZoomEffectEditor';
import { CaptionEditor } from './CaptionEditor';
import { OverlayEditor } from './OverlayEditor';
import { AudioEditor } from './AudioEditor';
import type { VideoSegment, CaptionSegment, ZoomEffectSegment, OverlaySegment, AudioSegment } from '@proj/shared';

const SEGMENT_TYPE_INFO: Record<string, { label: string; color: string; shortLabel: string }> = {
  video: { label: 'Video Segment', color: 'bg-accent-cyan/30', shortLabel: 'Video' },
  caption: { label: 'Caption', color: 'bg-accent-amber/30', shortLabel: 'Caption' },
  overlay: { label: 'Overlay', color: 'bg-accent-green/30', shortLabel: 'Overlay' },
  audio: { label: 'Audio', color: 'bg-accent-blue/30', shortLabel: 'Audio' },
  zoom: { label: 'Zoom Effect', color: 'bg-accent-magenta/30', shortLabel: 'Zoom' },
};

export function SegmentEditor() {
  const {
    project,
    selectedSegmentIds,
    deleteSegment,
    splitSegment,
    addCaptionSegment,
    addZoomEffectSegment,
    addOverlaySource,
    addOverlaySegment,
    addAudioSource,
    addAudioSegment,
    mergeVideoSegments,
  } = useTimelineStore();
  const overlayFileRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);

  const timeline = project?.timeline;

  // Find all selected segments
  const selectedSegments = useMemo(() => {
    if (!timeline) return [];
    return selectedSegmentIds
      .map(id => timeline.tracks.flatMap(t => t.segments).find(s => s.id === id))
      .filter((s): s is typeof s & { id: string } => s !== undefined);
  }, [timeline, selectedSegmentIds]);

  // Check if all selected are video segments (for merge)
  const allSelectedAreVideo = selectedSegments.length > 0 &&
    selectedSegments.every(s => s.type === 'video');

  // Check if segments can be merged (consecutive in source)
  const canMerge = useMemo(() => {
    if (selectedSegments.length < 2 || !allSelectedAreVideo) return false;

    const videoSegments = selectedSegments as VideoSegment[];
    const sorted = [...videoSegments].sort((a, b) => a.sourceStart - b.sourceStart);

    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = Math.abs(sorted[i].sourceEnd - sorted[i + 1].sourceStart);
      if (gap > 0.05) return false;
    }
    return true;
  }, [selectedSegments, allSelectedAreVideo]);

  const handleDelete = useCallback(() => {
    selectedSegmentIds.forEach(id => deleteSegment(id));
  }, [selectedSegmentIds, deleteSegment]);

  const handleSplit = useCallback(() => {
    if (selectedSegmentIds.length === 1 && timeline) {
      splitSegment(selectedSegmentIds[0], timeline.playheadPosition);
    }
  }, [selectedSegmentIds, timeline, splitSegment]);

  const handleAddCaption = useCallback(() => {
    if (!timeline) return;
    addCaptionSegment(timeline.playheadPosition, 3, 'New caption');
  }, [timeline, addCaptionSegment]);

  const handleAddZoomEffect = useCallback(() => {
    if (!timeline) return;
    addZoomEffectSegment(timeline.playheadPosition, 2);
  }, [timeline, addZoomEffectSegment]);

  const handleAddOverlay = useCallback(() => {
    overlayFileRef.current?.click();
  }, []);

  const handleAddAudio = useCallback(() => {
    audioFileRef.current?.click();
  }, []);

  const handleAudioFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!timeline || !e.target.files?.length) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('audio', file);

    try {
      const res = await fetch('/api/upload/audio', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.source) {
        addAudioSource(data.source);
        addAudioSegment(
          data.source.id,
          timeline.playheadPosition,
          0,
          data.source.duration
        );
      }
    } catch (err) {
      console.error('Audio upload failed:', err);
    }
    e.target.value = '';
  }, [timeline, addAudioSource, addAudioSegment]);

  const handleOverlayFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!timeline || !e.target.files?.length) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('video', file);

    try {
      const res = await fetch('/api/upload/overlay', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.source) {
        addOverlaySource(data.source);
        addOverlaySegment(
          data.source.id,
          timeline.playheadPosition,
          0,
          data.source.duration
        );
      }
    } catch (err) {
      console.error('Overlay upload failed:', err);
    }
    e.target.value = '';
  }, [timeline, addOverlaySource, addOverlaySegment]);

  const handleMerge = useCallback(() => {
    mergeVideoSegments();
  }, [mergeVideoSegments]);

  // Hidden file inputs (always rendered)
  const fileInput = (
    <>
      <input
        ref={overlayFileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleOverlayFileChange}
      />
      <input
        ref={audioFileRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/aac,audio/mp4,audio/ogg,audio/flac,.mp3,.wav,.aac,.m4a,.ogg,.flac"
        className="hidden"
        onChange={handleAudioFileChange}
      />
    </>
  );

  // Card-style add buttons for empty state
  const addCards = (
    <div className="space-y-1">
      <button
        onClick={handleAddCaption}
        className="w-full text-left px-2.5 py-2 rounded border border-terminal-border hover:border-accent-primary/40 transition-colors group flex items-center gap-2"
        disabled={!timeline}
      >
        <svg className="w-4 h-4 text-accent-amber/50 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="6" y1="16" x2="14" y2="16" />
        </svg>
        <span className="text-sm font-medium text-terminal-text group-hover:text-accent-primary transition-colors">Caption</span>
        <span className="text-xs text-terminal-muted ml-auto">Text overlay</span>
      </button>
      <button
        onClick={handleAddZoomEffect}
        className="w-full text-left px-2.5 py-2 rounded border border-terminal-border hover:border-accent-primary/40 transition-colors group flex items-center gap-2"
        disabled={!timeline}
      >
        <svg className="w-4 h-4 text-accent-magenta/50 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
        </svg>
        <span className="text-sm font-medium text-terminal-text group-hover:text-accent-primary transition-colors">Zoom</span>
        <span className="text-xs text-terminal-muted ml-auto">Zoom region</span>
      </button>
      <button
        onClick={handleAddOverlay}
        className="w-full text-left px-2.5 py-2 rounded border border-terminal-border hover:border-accent-primary/40 transition-colors group flex items-center gap-2"
        disabled={!timeline}
      >
        <svg className="w-4 h-4 text-accent-green/50 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="14" height="14" rx="2" /><rect x="8" y="8" width="14" height="14" rx="2" />
        </svg>
        <span className="text-sm font-medium text-terminal-text group-hover:text-accent-primary transition-colors">Overlay</span>
        <span className="text-xs text-terminal-muted ml-auto">Layer video</span>
      </button>
      <button
        onClick={handleAddAudio}
        className="w-full text-left px-2.5 py-2 rounded border border-terminal-border hover:border-accent-primary/40 transition-colors group flex items-center gap-2"
        disabled={!timeline}
      >
        <svg className="w-4 h-4 text-accent-blue/50 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
        </svg>
        <span className="text-sm font-medium text-terminal-text group-hover:text-accent-primary transition-colors">Audio</span>
        <span className="text-xs text-terminal-muted ml-auto">Background music</span>
      </button>
      {fileInput}
    </div>
  );

  // Compact collapsible add buttons for when editing
  const addButtonsCollapsible = (
    <details className="group">
      <summary className="text-xs text-terminal-muted cursor-pointer hover:text-terminal-text select-none flex items-center gap-1">
        <span className="group-open:rotate-90 transition-transform inline-block">&#9656;</span>
        Add segment
      </summary>
      <div className="space-y-1 mt-2">
        <button
          onClick={handleAddCaption}
          className="btn w-full text-xs py-1.5 flex items-center gap-2 justify-center"
          disabled={!timeline}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-amber" />
          Caption
        </button>
        <button
          onClick={handleAddZoomEffect}
          className="btn w-full text-xs py-1.5 flex items-center gap-2 justify-center"
          disabled={!timeline}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-magenta" />
          Zoom Effect
        </button>
        <button
          onClick={handleAddOverlay}
          className="btn w-full text-xs py-1.5 flex items-center gap-2 justify-center"
          disabled={!timeline}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
          Overlay
        </button>
        <button
          onClick={handleAddAudio}
          className="btn w-full text-xs py-1.5 flex items-center gap-2 justify-center"
          disabled={!timeline}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
          Audio
        </button>
        {fileInput}
      </div>
    </details>
  );

  // No selection
  if (selectedSegments.length === 0) {
    return (
      <div className="p-4">
        <h2 className="text-sm font-bold text-terminal-muted mb-4">Editor</h2>
        <p className="text-sm text-terminal-muted mb-4">
          Select a segment to edit
        </p>
        <p className="text-xs text-terminal-muted mb-4">
          Shift+click to select multiple
        </p>

        {addCards}

        <div className="mt-8 text-xs text-terminal-muted space-y-1">
          <p className="font-bold text-terminal-text">Keyboard Shortcuts:</p>
          <p>Space - Play/Pause</p>
          <p>← / → - Frame step</p>
          <p>J / K / L - Shuttle controls</p>
          <p>Home / End - Jump to start/end</p>
        </div>
      </div>
    );
  }

  // Multiple selection
  if (selectedSegments.length > 1) {
    return (
      <div className="p-4">
        <h2 className="text-sm font-bold text-accent-primary mb-4">
          {selectedSegments.length} Segments Selected
        </h2>

        <div className="panel p-3 mb-4 text-xs space-y-1">
          {selectedSegments.map((seg) => (
            <div key={seg.id} className="flex justify-between">
              <span className="text-accent-primary">
                {SEGMENT_TYPE_INFO[seg.type]?.shortLabel ?? seg.type}
              </span>
              <span className="text-terminal-muted">
                {formatTime(seg.startTime)} - {formatTime(seg.startTime + seg.duration)}
              </span>
            </div>
          ))}
        </div>

        {/* Merge button - only for consecutive video segments */}
        {allSelectedAreVideo && (
          <button
            onClick={handleMerge}
            className={`w-full text-sm mb-2 ${canMerge ? 'btn-primary' : 'btn opacity-50'}`}
            disabled={!canMerge}
            title={canMerge ? 'Merge selected segments' : 'Segments must be consecutive in source video'}
          >
            Merge Segments
          </button>
        )}

        {!canMerge && allSelectedAreVideo && selectedSegments.length >= 2 && (
          <p className="text-xs text-accent-primary mb-4">
            Segments must be consecutive in source video to merge
          </p>
        )}

        <button
          onClick={handleDelete}
          className="btn-danger w-full text-sm"
        >
          Delete {selectedSegments.length} Segments
        </button>
      </div>
    );
  }

  // Single selection
  const selectedSegment = selectedSegments[0];
  const isVideo = selectedSegment.type === 'video';
  const isCaption = selectedSegment.type === 'caption';
  const isZoom = selectedSegment.type === 'zoom';
  const isOverlay = selectedSegment.type === 'overlay';
  const isAudio = selectedSegment.type === 'audio';

  const { label: segmentTypeLabel, color: typeColor } = SEGMENT_TYPE_INFO[selectedSegment.type] ?? SEGMENT_TYPE_INFO.zoom;

  return (
    <div className="p-4 flex flex-col min-h-full">
      {/* Segment header with type indicator */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full ${typeColor}`} />
          <h2 className="text-sm font-bold text-accent-primary">
            {segmentTypeLabel}
          </h2>
        </div>
        <div className="text-xs text-terminal-muted pl-4">
          {formatTime(selectedSegment.startTime)} - {formatTime(selectedSegment.startTime + selectedSegment.duration)} ({formatTime(selectedSegment.duration)})
          {isVideo && (
            <span className="ml-2">
              src: {formatTime((selectedSegment as VideoSegment).sourceStart)}-{formatTime((selectedSegment as VideoSegment).sourceEnd)}
            </span>
          )}
        </div>
      </div>

      {/* Video-specific editors */}
      {isVideo && (
        <>
          <div className="mb-4">
            <button
              onClick={handleSplit}
              className="btn w-full text-sm"
            >
              Split at Playhead
            </button>
          </div>

          <SpeedEditor segment={selectedSegment as VideoSegment} />
        </>
      )}

      {/* Caption editor */}
      {isCaption && (
        <CaptionEditor segment={selectedSegment as CaptionSegment} />
      )}

      {/* Zoom effect editor */}
      {isZoom && (
        <ZoomEffectEditor segment={selectedSegment as ZoomEffectSegment} />
      )}

      {/* Overlay editor */}
      {isOverlay && (
        <OverlayEditor segment={selectedSegment as OverlaySegment} />
      )}

      {/* Audio editor */}
      {isAudio && (
        <AudioEditor segment={selectedSegment as AudioSegment} />
      )}

      {/* Add buttons (collapsible) */}
      <div className="mt-4">
        {addButtonsCollapsible}
      </div>

      {/* Delete at bottom, separated */}
      <div className="mt-6 pt-4 border-t border-terminal-border">
        <button
          onClick={handleDelete}
          className="btn-danger w-full text-xs py-1.5"
        >
          Delete {segmentTypeLabel}
        </button>
      </div>
    </div>
  );
}
