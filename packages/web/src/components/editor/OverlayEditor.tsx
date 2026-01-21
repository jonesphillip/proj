import { useCallback, useMemo } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { formatTime } from '../../utils/format';
import { Slider } from '../ui/Slider';
import type { OverlaySegment } from '@proj/shared';
import { DEVICE_FRAME_PRESETS } from '@proj/shared';

interface OverlayEditorProps {
  segment: OverlaySegment;
}

const POSITION_PRESETS = [
  { label: 'Bottom-Right', x: 0.62, y: 0.55 },
  { label: 'Bottom-Left', x: 0.03, y: 0.55 },
  { label: 'Top-Right', x: 0.62, y: 0.05 },
  { label: 'Top-Left', x: 0.03, y: 0.05 },
  { label: 'Center', x: 0.325, y: 0.3 },
] as const;

const SIZE_PRESETS = [
  { label: 'Small', width: 0.2, height: 0.3 },
  { label: 'Medium', width: 0.35, height: 0.4 },
  { label: 'Large', width: 0.5, height: 0.55 },
] as const;

export function OverlayEditor({ segment }: OverlayEditorProps) {
  const { updateOverlaySegment, saveHistory, project } = useTimelineStore();

  // Video aspect ratio needed to convert between normalized width/height spaces
  const videoAspect = useMemo(() => {
    if (!project?.source) return 16 / 9;
    return project.source.width / project.source.height;
  }, [project?.source]);

  // Get active device frame and its aspect ratio (width/height in normalized space)
  const activeFrame = segment.deviceFrameId
    ? DEVICE_FRAME_PRESETS.find(f => f.id === segment.deviceFrameId) || null
    : null;
  // Frame aspect ratio: how wide relative to tall (e.g. phone ~0.48)
  const frameAspect = activeFrame ? activeFrame.width / activeFrame.height : null;

  const handlePositionPreset = useCallback((x: number, y: number) => {
    updateOverlaySegment(segment.id, {
      position: { ...segment.position, x, y },
    });
    saveHistory();
  }, [segment.id, segment.position, updateOverlaySegment, saveHistory]);

  const handleSizePreset = useCallback((width: number, height: number) => {
    let finalWidth = width;
    let finalHeight = frameAspect ? width * videoAspect / frameAspect : height;
    // Clamp: if phone is taller than the video, scale down width to fit
    if (frameAspect && finalHeight > 0.95) {
      finalHeight = 0.95;
      finalWidth = finalHeight * frameAspect / videoAspect;
    }
    updateOverlaySegment(segment.id, {
      position: { ...segment.position, width: finalWidth, height: finalHeight },
    });
    saveHistory();
  }, [segment.id, segment.position, frameAspect, videoAspect, updateOverlaySegment, saveHistory]);

  const handleDeviceFrame = useCallback((frameId: string | null) => {
    const frame = frameId ? DEVICE_FRAME_PRESETS.find(f => f.id === frameId) : null;
    if (frame) {
      // Lock aspect ratio: keep current width, adjust height
      // Account for video aspect: pos.width is fraction of videoW, pos.height is fraction of videoH
      const aspect = frame.width / frame.height;
      let newWidth = segment.position.width;
      let newHeight = newWidth * videoAspect / aspect;
      // Clamp: if phone is taller than the video, scale down width to fit
      if (newHeight > 0.95) {
        newHeight = 0.95;
        newWidth = newHeight * aspect / videoAspect;
      }
      updateOverlaySegment(segment.id, {
        deviceFrameId: frameId,
        position: { ...segment.position, width: newWidth, height: newHeight },
      });
    } else {
      updateOverlaySegment(segment.id, { deviceFrameId: frameId });
    }
    saveHistory();
  }, [segment.id, segment.position, videoAspect, updateOverlaySegment, saveHistory]);

  const handleOpacity = useCallback((opacity: number) => {
    updateOverlaySegment(segment.id, { opacity });
  }, [segment.id, updateOverlaySegment]);

  const handleBorderRadius = useCallback((borderRadius: number) => {
    updateOverlaySegment(segment.id, { borderRadius });
  }, [segment.id, updateOverlaySegment]);

  return (
    <div className="space-y-4">
      {/* Drag hint */}
      <div className="panel p-3 border-accent-primary/30">
        <p className="text-xs text-accent-primary font-medium mb-1">Position & Size</p>
        <p className="text-xs text-terminal-muted">
          Drag and resize the green box in the preview to position the overlay.
        </p>
      </div>

      {/* Position presets */}
      <div>
        <h4 className="text-xs font-medium text-terminal-muted uppercase tracking-wider mb-2">Position</h4>
        <div className="grid grid-cols-3 gap-1">
          {POSITION_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => handlePositionPreset(p.x, p.y)}
              className="btn text-xs py-1.5"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Size presets */}
      <div>
        <h4 className="text-xs font-medium text-terminal-muted uppercase tracking-wider mb-2">Size</h4>
        <div className="grid grid-cols-3 gap-1">
          {SIZE_PRESETS.map((s) => (
            <button
              key={s.label}
              onClick={() => handleSizePreset(s.width, s.height)}
              className="btn text-xs py-1.5"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Device frame selector */}
      <div>
        <h4 className="text-xs font-medium text-terminal-muted uppercase tracking-wider mb-2">Device Frame</h4>
        <select
          value={segment.deviceFrameId || ''}
          onChange={(e) => handleDeviceFrame(e.target.value || null)}
          className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text"
        >
          <option value="">None</option>
          {DEVICE_FRAME_PRESETS.map((frame) => (
            <option key={frame.id} value={frame.id}>{frame.name}</option>
          ))}
        </select>
      </div>

      {/* Opacity */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-terminal-muted">Opacity</label>
          <span className="text-xs text-accent-primary font-medium">{Math.round(segment.opacity * 100)}%</span>
        </div>
        <Slider
          value={segment.opacity}
          min={0.1}
          max={1}
          step={0.05}
          onChange={handleOpacity}
          onChangeEnd={saveHistory}
          color="#9B8EC4"
        />
      </div>

      {/* Border radius */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-terminal-muted">Border Radius</label>
          <span className="text-xs text-accent-primary font-medium">{segment.borderRadius}px</span>
        </div>
        <Slider
          value={segment.borderRadius}
          min={0}
          max={50}
          step={1}
          onChange={handleBorderRadius}
          onChangeEnd={saveHistory}
          color="#9B8EC4"
        />
      </div>

      {/* Source info */}
      <div className="text-xs text-terminal-muted border-t border-terminal-border pt-3">
        <div className="flex justify-between">
          <span>Source In:</span>
          <span>{formatTime(segment.sourceStart)}</span>
        </div>
        <div className="flex justify-between">
          <span>Source Out:</span>
          <span>{formatTime(segment.sourceEnd)}</span>
        </div>
      </div>
    </div>
  );
}
