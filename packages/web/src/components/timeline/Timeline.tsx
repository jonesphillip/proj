import { useRef, useCallback, useEffect, useState } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { TimeRuler } from './TimeRuler';
import type { Segment as SegmentType, VideoSegment, CaptionSegment, ZoomEffectSegment, AudioSegment } from '@proj/shared';

const TRACK_HEIGHT = 48;
const LABEL_WIDTH = 100;
const RULER_HEIGHT = 28;
const MIN_SEGMENT_DURATION = 0.1; // Minimum segment duration in seconds

// Color classes keyed by track/segment type
const TRACK_LABEL_COLOR: Record<string, string> = {
  video: 'text-accent-cyan',
  caption: 'text-accent-amber',
  overlay: 'text-accent-green',
  audio: 'text-accent-blue',
  effect: 'text-accent-magenta',
};

const SEGMENT_COLORS: Record<string, string> = {
  video: 'bg-accent-cyan/10 border-l-[3px] border-l-accent-cyan hover:bg-accent-cyan/20',
  caption: 'bg-accent-amber/10 border-l-[3px] border-l-accent-amber hover:bg-accent-amber/20',
  overlay: 'bg-accent-green/10 border-l-[3px] border-l-accent-green hover:bg-accent-green/20',
  audio: 'bg-accent-blue/10 border-l-[3px] border-l-accent-blue hover:bg-accent-blue/20',
  zoom: 'bg-accent-magenta/10 border-l-[3px] border-l-accent-magenta hover:bg-accent-magenta/20',
};

const EDGE_COLOR: Record<string, string> = {
  video: 'bg-accent-cyan',
  caption: 'bg-accent-amber',
  overlay: 'bg-accent-green',
  audio: 'bg-accent-blue',
  zoom: 'bg-accent-magenta',
};

export function Timeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    segmentId: string | null;
    time: number;
  } | null>(null);

  // Dragging state - supports edge dragging and full segment movement
  const [dragging, setDragging] = useState<{
    segmentId: string;
    segmentType: string;
    mode: 'left' | 'right' | 'move';
    initialX: number;
    initialStartTime: number;
    initialDuration: number;
    initialSourceStart?: number;
    initialSourceEnd?: number;
  } | null>(null);

  // Track reorder drag state
  const [trackDrag, setTrackDrag] = useState<{
    trackId: string;
    startY: number;
    currentIndex: number;
    overIndex: number;
  } | null>(null);

  const {
    project,
    setPlayheadPosition,
    setPixelsPerSecond,
    setIsPlaying,
    selectSegment,
    splitSegment,
    deleteSegment,
    updateSegment,
    trimVideoSource,
    combineOverlaySegments,
    mergeVideoSegments,
    addCaptionSegment,
    addZoomEffectSegment,
    reorderTrack,
    saveHistory,
    selectedSegmentIds,
  } = useTimelineStore();

  // Refs for file inputs (overlay/audio upload from context menu)
  const overlayFileRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);

  const timeline = project?.timeline;

  // Handle zoom with wheel
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const currentPps = timeline?.pixelsPerSecond || 50;
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      setPixelsPerSecond(currentPps * factor);
    }
  }, [timeline?.pixelsPerSecond, setPixelsPerSecond]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) {
      scroll.addEventListener('wheel', handleWheel, { passive: false });
      return () => scroll.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // Click to seek
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!timeline || !scrollRef.current) return;
    // Don't seek if clicking on a segment or label area
    if ((e.target as HTMLElement).closest('.segment')) return;

    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft - LABEL_WIDTH;
    if (x < 0) return; // Clicked on label column
    const time = x / timeline.pixelsPerSecond;

    setPlayheadPosition(Math.max(0, Math.min(time, timeline.duration)));
    setIsPlaying(false);
    selectSegment(null);
    setContextMenu(null);
  }, [timeline, setPlayheadPosition, setIsPlaying, selectSegment]);

  // Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, segmentId: string) => {
    e.preventDefault();
    if (!timeline || !scrollRef.current) return;

    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft - LABEL_WIDTH;
    const time = x / timeline.pixelsPerSecond;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      segmentId,
      time,
    });
    // Only reset selection if the right-clicked segment isn't already selected
    // (preserves multi-select for combine overlays)
    if (!selectedSegmentIds.includes(segmentId)) {
      selectSegment(segmentId);
    }
  }, [timeline, selectSegment, selectedSegmentIds]);

  // Close context menu
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const handleSplitAtPlayhead = useCallback(() => {
    if (contextMenu?.segmentId && timeline) {
      splitSegment(contextMenu.segmentId, timeline.playheadPosition);
      setContextMenu(null);
    }
  }, [contextMenu, timeline, splitSegment]);

  const handleDeleteSegment = useCallback(() => {
    if (contextMenu?.segmentId) {
      deleteSegment(contextMenu.segmentId);
      setContextMenu(null);
    }
  }, [contextMenu, deleteSegment]);

  const handleCombineOverlays = useCallback(() => {
    if (selectedSegmentIds.length >= 2) {
      combineOverlaySegments(selectedSegmentIds);
      setContextMenu(null);
    }
  }, [selectedSegmentIds, combineOverlaySegments]);

  const handleCombineVideos = useCallback(() => {
    if (selectedSegmentIds.length >= 2) {
      mergeVideoSegments();
      setContextMenu(null);
    }
  }, [selectedSegmentIds, mergeVideoSegments]);

  // Right-click on empty timeline space
  const handleTimelineContextMenu = useCallback((e: React.MouseEvent) => {
    // Don't show add menu if right-clicking on a segment (handled by segment's own handler)
    if ((e.target as HTMLElement).closest('.segment')) return;
    e.preventDefault();
    if (!timeline || !scrollRef.current) return;

    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft - LABEL_WIDTH;
    const time = x / timeline.pixelsPerSecond;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      segmentId: null,
      time: Math.max(0, Math.min(time, timeline.duration)),
    });
  }, [timeline]);

  // Add-segment handlers from context menu
  const handleAddCaptionAt = useCallback(() => {
    if (!contextMenu || !timeline) return;
    addCaptionSegment(contextMenu.time, 3, 'New caption');
    setContextMenu(null);
  }, [contextMenu, timeline, addCaptionSegment]);

  const handleAddZoomAt = useCallback(() => {
    if (!contextMenu || !timeline) return;
    addZoomEffectSegment(contextMenu.time, 2);
    setContextMenu(null);
  }, [contextMenu, timeline, addZoomEffectSegment]);

  const handleAddOverlayAt = useCallback(() => {
    setContextMenu(null);
    overlayFileRef.current?.click();
  }, []);

  const handleAddAudioAt = useCallback(() => {
    setContextMenu(null);
    audioFileRef.current?.click();
  }, []);

  // File upload handlers for overlay/audio from context menu
  const { addOverlaySource, addOverlaySegment, addAudioSource, addAudioSegment } = useTimelineStore();

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
        addOverlaySegment(data.source.id, timeline.playheadPosition, 0, data.source.duration);
      }
    } catch (err) {
      console.error('Overlay upload failed:', err);
    }
    e.target.value = '';
  }, [timeline, addOverlaySource, addOverlaySegment]);

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
        addAudioSegment(data.source.id, timeline.playheadPosition, 0, data.source.duration);
      }
    } catch (err) {
      console.error('Audio upload failed:', err);
    }
    e.target.value = '';
  }, [timeline, addAudioSource, addAudioSegment]);

  // Check if we can show combine options
  const allSegments = timeline?.tracks.flatMap(t => t.segments) || [];
  const selectedTypes = selectedSegmentIds.map(id => allSegments.find(s => s.id === id)?.type);

  const canCombineOverlays = selectedSegmentIds.length >= 2 && selectedTypes.every(t => t === 'overlay');
  const canCombineVideos = selectedSegmentIds.length >= 2 && selectedTypes.every(t => t === 'video');

  // Drag handlers for edge dragging and full segment movement
  const handleDragStart = useCallback((
    segmentId: string,
    mode: 'left' | 'right' | 'move',
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    e.preventDefault();

    const segment = timeline?.tracks
      .flatMap(t => t.segments)
      .find(s => s.id === segmentId);

    if (!segment) return;

    // Video segments cannot be moved freely (they stay continuous)
    if (segment.type === 'video' && mode === 'move') {
      selectSegment(segmentId);
      return;
    }

    const dragState: typeof dragging = {
      segmentId,
      segmentType: segment.type,
      mode,
      initialX: e.clientX,
      initialStartTime: segment.startTime,
      initialDuration: segment.duration,
    };

    // For video segments, also track source bounds
    if (segment.type === 'video') {
      const videoSeg = segment as VideoSegment;
      dragState.initialSourceStart = videoSeg.sourceStart;
      dragState.initialSourceEnd = videoSeg.sourceEnd;
    }

    setDragging(dragState);
    selectSegment(segmentId);
  }, [timeline, selectSegment]);

  // Handle mouse move during drag
  useEffect(() => {
    if (!dragging || !timeline) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragging.initialX;
      const deltaTime = deltaX / timeline.pixelsPerSecond;

      if (dragging.segmentType === 'video' &&
          dragging.initialSourceStart !== undefined &&
          dragging.initialSourceEnd !== undefined) {
        // For video segments, calculate new absolute source bounds
        let newSourceStart = dragging.initialSourceStart;
        let newSourceEnd = dragging.initialSourceEnd;

        if (dragging.mode === 'left') {
          // Dragging left edge: adjust sourceStart
          newSourceStart = dragging.initialSourceStart + deltaTime;
        } else if (dragging.mode === 'right') {
          // Dragging right edge: adjust sourceEnd
          newSourceEnd = dragging.initialSourceEnd + deltaTime;
        }
        // Note: 'move' mode is blocked for video segments in handleDragStart

        // This also recomputes positions to maintain continuity
        trimVideoSource(dragging.segmentId, newSourceStart, newSourceEnd);
      } else {
        // For non-video segments (captions, zoom effects)
        if (dragging.mode === 'move') {
          // Move the entire segment
          const newStartTime = Math.max(0, dragging.initialStartTime + deltaTime);
          updateSegment(dragging.segmentId, {
            startTime: newStartTime,
          });
        } else if (dragging.mode === 'left') {
          // Adjust left edge: change start time and duration
          const newStartTime = Math.max(0, dragging.initialStartTime + deltaTime);
          const newDuration = dragging.initialDuration - (newStartTime - dragging.initialStartTime);

          if (newDuration >= MIN_SEGMENT_DURATION) {
            updateSegment(dragging.segmentId, {
              startTime: newStartTime,
              duration: newDuration,
            });
          }
        } else {
          // Adjust right edge: change duration only
          const newDuration = Math.max(MIN_SEGMENT_DURATION, dragging.initialDuration + deltaTime);
          updateSegment(dragging.segmentId, {
            duration: newDuration,
          });
        }
      }
    };

    const handleMouseUp = () => {
      // Save history when drag ends
      saveHistory();
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, timeline, updateSegment, trimVideoSource, saveHistory]);

  // Track reorder drag handling
  useEffect(() => {
    if (!trackDrag || !timeline) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - trackDrag.startY;
      const indexOffset = Math.round(deltaY / TRACK_HEIGHT);
      const newOverIndex = Math.max(1, Math.min(
        trackDrag.currentIndex + indexOffset,
        timeline.tracks.length - 1,
      ));
      if (newOverIndex !== trackDrag.overIndex) {
        setTrackDrag(prev => prev ? { ...prev, overIndex: newOverIndex } : null);
      }
    };

    const handleMouseUp = () => {
      if (trackDrag.overIndex !== trackDrag.currentIndex) {
        reorderTrack(trackDrag.trackId, trackDrag.overIndex);
        saveHistory();
      }
      setTrackDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [trackDrag, timeline, reorderTrack, saveHistory]);

  if (!timeline || !project) {
    return (
      <div className="h-full flex items-center justify-center text-terminal-muted">
        No timeline
      </div>
    );
  }

  const totalWidth = Math.max(timeline.duration * timeline.pixelsPerSecond, 100);
  // Only show tracks that have segments (video track always shown)
  const visibleTracks = timeline.tracks.filter(t => t.type === 'video' || t.segments.length > 0);

  return (
    <div className="h-full flex flex-col bg-terminal-surface overflow-hidden">
      {/* Timeline header with zoom controls */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-terminal-border">
        <span className="text-sm text-terminal-muted">Timeline</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPixelsPerSecond(timeline.pixelsPerSecond * 0.7)}
            className="btn px-2 py-1 text-xs"
            title="Zoom out (Ctrl+Scroll)"
          >
            −
          </button>
          <span className="text-xs text-terminal-muted w-20 text-center">
            {Math.round(timeline.pixelsPerSecond)}px/s
          </span>
          <button
            onClick={() => setPixelsPerSecond(timeline.pixelsPerSecond * 1.4)}
            className="btn px-2 py-1 text-xs"
            title="Zoom in (Ctrl+Scroll)"
          >
            +
          </button>
          <button
            onClick={() => setPixelsPerSecond(Math.max(1, 600 / timeline.duration))}
            className="btn px-2 py-1 text-xs"
            title="Fit to view"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Timeline body — single scroll container, labels sticky-left */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto min-h-0 cursor-crosshair"
        onClick={handleTimelineClick}
      >
        <div className="relative flex flex-col" style={{ width: totalWidth + LABEL_WIDTH, minHeight: '100%' }}>
          {/* Ruler row */}
          <div className="flex flex-shrink-0" style={{ height: RULER_HEIGHT }}>
            <div
              className="sticky left-0 z-30 bg-terminal-surface border-b border-terminal-border"
              style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
            />
            <div className="border-b border-terminal-border" style={{ width: totalWidth }}>
              <TimeRuler
                duration={timeline.duration}
                pixelsPerSecond={timeline.pixelsPerSecond}
              />
            </div>
          </div>

          {/* Track rows */}
          {visibleTracks.map((track) => {
            const trackIndex = timeline.tracks.indexOf(track);
            const isDraggingThis = trackDrag?.trackId === track.id;
            const isDropTarget = trackDrag && !isDraggingThis && trackDrag.overIndex === trackIndex;
            const canDrag = track.type !== 'video';

            return (
            <div
              key={track.id}
              className={`flex flex-shrink-0 ${isDraggingThis ? 'opacity-40' : ''}`}
              style={{ height: TRACK_HEIGHT }}
            >
              <div
                className={`sticky left-0 z-30 bg-terminal-surface flex items-center px-2 border-b border-terminal-border
                  ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${isDropTarget ? 'border-t-2 border-t-accent-primary' : ''}`}
                style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
                onMouseDown={canDrag ? (e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  setTrackDrag({
                    trackId: track.id,
                    startY: e.clientY,
                    currentIndex: trackIndex,
                    overIndex: trackIndex,
                  });
                } : undefined}
              >
                <span className={`text-xs font-medium ${TRACK_LABEL_COLOR[track.type] ?? 'text-accent-magenta'}`}>
                  {track.name}
                </span>
              </div>
              <div
                className={`relative border-b border-terminal-border bg-terminal-bg/50 cursor-crosshair
                  ${isDropTarget ? 'border-t-2 border-t-accent-primary' : ''}`}
                style={{ width: totalWidth, height: TRACK_HEIGHT }}
                onContextMenu={handleTimelineContextMenu}
              >
                {track.segments.map(segment => (
                  <SegmentBlock
                    key={segment.id}
                    segment={segment}
                    pixelsPerSecond={timeline.pixelsPerSecond}
                    isSelected={selectedSegmentIds.includes(segment.id)}
                    isDragging={dragging?.segmentId === segment.id}
                    onSelect={(e) => selectSegment(segment.id, e.shiftKey)}
                    onContextMenu={(e) => handleContextMenu(e, segment.id)}
                    onDragStart={(mode, e) => handleDragStart(segment.id, mode, e)}
                  />
                ))}
              </div>
            </div>
            );
          })}

          {/* Empty timeline area - right-click to add segments */}
          <div className="flex flex-1" style={{ minHeight: TRACK_HEIGHT }}>
            <div
              className="sticky left-0 z-30 bg-terminal-surface"
              style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
            />
            <div
              className="cursor-crosshair"
              style={{ width: totalWidth }}
              onContextMenu={handleTimelineContextMenu}
            />
          </div>

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-accent-primary pointer-events-none z-20"
            style={{
              left: LABEL_WIDTH + timeline.playheadPosition * timeline.pixelsPerSecond,
            }}
          >
            <div
              className="absolute -top-0 left-1/2 -translate-x-1/2 w-0 h-0"
              style={{
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderTop: '8px solid #9B8EC4',
              }}
            />
          </div>
        </div>
      </div>

      {/* Hidden file inputs for overlay/audio upload from context menu */}
      <input
        ref={overlayFileRef}
        type="file"
        accept="video/*,image/*"
        className="hidden"
        onChange={handleOverlayFileChange}
      />
      <input
        ref={audioFileRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/aac,audio/m4a,audio/ogg,audio/flac"
        className="hidden"
        onChange={handleAudioFileChange}
      />

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed flex flex-col bg-terminal-surface border border-terminal-border rounded shadow-lg py-0.5 z-50"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 160),
            top: Math.min(contextMenu.y, window.innerHeight - 180),
            width: 'max-content',
            minWidth: 120,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.segmentId ? (
            <>
              <button
                className="px-3 py-1 text-left text-xs text-terminal-text hover:bg-terminal-border/50 whitespace-nowrap"
                onClick={handleSplitAtPlayhead}
              >
                Split at playhead
              </button>
              {canCombineOverlays && (
                <button
                  className="px-3 py-1 text-left text-xs text-terminal-text hover:bg-terminal-border/50 whitespace-nowrap"
                  onClick={handleCombineOverlays}
                >
                  Combine overlays
                </button>
              )}
              {canCombineVideos && (
                <button
                  className="px-3 py-1 text-left text-xs text-terminal-text hover:bg-terminal-border/50 whitespace-nowrap"
                  onClick={handleCombineVideos}
                >
                  Combine segments
                </button>
              )}
              <div className="my-0.5 border-t border-terminal-border" />
              <button
                className="px-3 py-1 text-left text-xs text-accent-red hover:bg-terminal-border/50 whitespace-nowrap"
                onClick={handleDeleteSegment}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <div className="px-3 py-0.5 text-[10px] text-terminal-muted">
                {contextMenu.time.toFixed(1)}s
              </div>
              <button
                className="px-3 py-1 text-left text-xs text-terminal-text hover:bg-terminal-border/50 whitespace-nowrap"
                onClick={handleAddCaptionAt}
              >
                Add caption
              </button>
              <button
                className="px-3 py-1 text-left text-xs text-terminal-text hover:bg-terminal-border/50 whitespace-nowrap"
                onClick={handleAddZoomAt}
              >
                Add zoom
              </button>
              <button
                className="px-3 py-1 text-left text-xs text-terminal-text hover:bg-terminal-border/50 whitespace-nowrap"
                onClick={handleAddOverlayAt}
              >
                Add overlay...
              </button>
              <button
                className="px-3 py-1 text-left text-xs text-terminal-text hover:bg-terminal-border/50 whitespace-nowrap"
                onClick={handleAddAudioAt}
              >
                Add audio...
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface SegmentBlockProps {
  segment: SegmentType;
  pixelsPerSecond: number;
  isSelected: boolean;
  isDragging: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (mode: 'left' | 'right' | 'move', e: React.MouseEvent) => void;
}

function SegmentBlock({ segment, pixelsPerSecond, isSelected, isDragging, onSelect, onContextMenu, onDragStart }: SegmentBlockProps) {
  const project = useTimelineStore((state) => state.project);
  const left = segment.startTime * pixelsPerSecond;
  const width = Math.max(segment.duration * pixelsPerSecond, 4);

  const isVideo = segment.type === 'video';
  const isCaption = segment.type === 'caption';
  const isZoom = segment.type === 'zoom';
  const isOverlay = segment.type === 'overlay';
  const isAudio = segment.type === 'audio';
  const canMove = !isVideo; // Only non-video segments can be moved freely

  // Get segment label
  let label = '';
  if (isVideo) {
    const videoSeg = segment as VideoSegment;
    const speed = videoSeg.effects.speed?.rate;
    const hasZoom = videoSeg.effects.zoom && videoSeg.effects.zoom.keyframes.length > 0;
    label = 'Video';
    if (speed && speed !== 1) label += ` ${speed}x`;
    if (hasZoom) label += ' [z]';
    if (videoSeg.effects.audioMuted) label += ' [m]';
  } else if (isCaption) {
    const captionSeg = segment as CaptionSegment;
    label = captionSeg.text.slice(0, 15) + (captionSeg.text.length > 15 ? '...' : '');
  } else if (isZoom) {
    const zoomSeg = segment as ZoomEffectSegment;
    label = `Zoom ${zoomSeg.zoom}x`;
  } else if (isOverlay) {
    label = 'Overlay';
  } else if (isAudio) {
    const audioSeg = segment as AudioSegment;
    const audioSource = project?.audioSources?.find(s => s.id === audioSeg.audioSourceId);
    label = audioSource?.filename?.replace(/\.[^.]+$/, '').slice(0, 12) || 'Audio';
    if (audioSeg.muted) label += ' [m]';
  }

  // Get waveform data for display
  let waveformPeaks: number[] | undefined;
  let waveformMuted = false;
  let sourceStartRatio = 0;
  let sourceEndRatio = 1;

  if (isVideo && project?.source?.waveform?.length) {
    waveformPeaks = project.source.waveform;
    waveformMuted = !!(segment as VideoSegment).effects.audioMuted;
    const videoSeg = segment as VideoSegment;
    sourceStartRatio = videoSeg.sourceStart / project.source.duration;
    sourceEndRatio = videoSeg.sourceEnd / project.source.duration;
  } else if (isAudio && project?.audioSources) {
    const audioSeg = segment as AudioSegment;
    const audioSource = project.audioSources.find(s => s.id === audioSeg.audioSourceId);
    if (audioSource?.waveform?.length) {
      waveformPeaks = audioSource.waveform;
      waveformMuted = audioSeg.muted;
      sourceStartRatio = audioSeg.sourceStart / audioSource.duration;
      sourceEndRatio = audioSeg.sourceEnd / audioSource.duration;
    }
  }

  const segmentColors = SEGMENT_COLORS[segment.type] ?? SEGMENT_COLORS.zoom;
  const edgeColor = EDGE_COLOR[segment.type] ?? EDGE_COLOR.zoom;

  return (
    <div
      className={`segment absolute top-1.5 bottom-1.5 transition-colors group
        ${segmentColors}
        ${isSelected ? 'ring-1 ring-accent-primary ring-offset-1 ring-offset-terminal-bg' : ''}
        ${isDragging ? 'opacity-80' : ''}
        ${canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      style={{ left, width }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(e);
      }}
      onMouseDown={(e) => {
        // Only initiate move drag for non-video segments on left-click (not right-click)
        // Skip drag when shift is held so click handler can manage multi-select
        if (e.button === 0 && canMove && !e.shiftKey && !(e.target as HTMLElement).dataset.edge) {
          onDragStart('move', e);
        }
      }}
      onContextMenu={onContextMenu}
    >
      {/* Left edge handle */}
      <div
        data-edge="left"
        className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10
          opacity-0 group-hover:opacity-100 transition-opacity ${edgeColor}`}
        style={{ borderRadius: '4px 0 0 4px' }}
        onMouseDown={(e) => onDragStart('left', e)}
      />

      {/* Right edge handle */}
      <div
        data-edge="right"
        className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-10
          opacity-0 group-hover:opacity-100 transition-opacity ${edgeColor}`}
        style={{ borderRadius: '0 4px 4px 0' }}
        onMouseDown={(e) => onDragStart('right', e)}
      />

      {/* Waveform + Label */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {waveformPeaks && waveformPeaks.length > 0 && (
          <WaveformDisplay
            peaks={waveformPeaks}
            startRatio={sourceStartRatio}
            endRatio={sourceEndRatio}
            color={isAudio ? '#3b82f6' : '#06b6d4'}
            muted={waveformMuted}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center px-3">
          <span className="text-xs truncate text-terminal-text font-medium">{label}</span>
        </div>
      </div>
    </div>
  );
}

// Waveform visualization inside timeline segments
function WaveformDisplay({
  peaks,
  startRatio,
  endRatio,
  color,
  muted,
}: {
  peaks: number[];
  startRatio: number;
  endRatio: number;
  color: string;
  muted: boolean;
}) {
  const startIdx = Math.floor(startRatio * peaks.length);
  const endIdx = Math.ceil(endRatio * peaks.length);
  const visiblePeaks = peaks.slice(startIdx, endIdx);

  if (visiblePeaks.length === 0) return null;

  const height = 32;
  const mid = height / 2;

  // Build SVG path for waveform
  const step = 100 / visiblePeaks.length;
  let pathD = `M 0 ${mid}`;
  for (let i = 0; i < visiblePeaks.length; i++) {
    const x = i * step + step / 2;
    const amp = visiblePeaks[i] * mid * 0.9;
    pathD += ` L ${x} ${mid - amp}`;
  }
  // Mirror back
  for (let i = visiblePeaks.length - 1; i >= 0; i--) {
    const x = i * step + step / 2;
    const amp = visiblePeaks[i] * mid * 0.9;
    pathD += ` L ${x} ${mid + amp}`;
  }
  pathD += ' Z';

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      style={{ opacity: muted ? 0.15 : 0.35 }}
    >
      <path d={pathD} fill={color} />
      {muted && (
        <line
          x1="0" y1={mid}
          x2="100" y2={mid}
          stroke={color}
          strokeWidth="2"
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
