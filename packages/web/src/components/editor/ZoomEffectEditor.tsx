import { useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { Slider } from '../ui/Slider';
import type { ZoomEffectSegment } from '@proj/shared';

interface ZoomEffectEditorProps {
  segment: ZoomEffectSegment;
}

export function ZoomEffectEditor({ segment }: ZoomEffectEditorProps) {
  const { updateZoomEffect, saveHistory } = useTimelineStore();

  const handleZoomChange = useCallback((zoom: number) => {
    updateZoomEffect(segment.id, { zoom });
  }, [segment.id, updateZoomEffect]);

  const handleZoomInDurationChange = useCallback((zoomInDuration: number) => {
    updateZoomEffect(segment.id, { zoomInDuration });
  }, [segment.id, updateZoomEffect]);

  const handleZoomOutDurationChange = useCallback((zoomOutDuration: number) => {
    updateZoomEffect(segment.id, { zoomOutDuration });
  }, [segment.id, updateZoomEffect]);

  // Get current values with defaults
  const zoomInDuration = segment.zoomInDuration ?? 0.3;
  const zoomOutDuration = segment.zoomOutDuration ?? 0.3;

  return (
    <div className="space-y-4">
      {/* Zoom area instruction */}
      <div className="panel p-3 border-accent-primary/30">
        <p className="text-xs text-accent-primary font-medium mb-1">Zoom Area</p>
        <p className="text-xs text-terminal-muted">
          Drag and resize the magenta box in the video preview to set the zoom area.
          The box shows what will be visible when zoomed.
        </p>
      </div>

      {/* Zoom level */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-terminal-muted">Zoom Level</label>
          <span className="text-xs text-accent-primary font-medium">{segment.zoom.toFixed(1)}x</span>
        </div>
        <Slider
          value={segment.zoom}
          min={1.1}
          max={4}
          step={0.1}
          onChange={handleZoomChange}
          onChangeEnd={saveHistory}
          color="#9B8EC4"
        />
        <div className="flex justify-between text-xs text-terminal-muted mt-1">
          <span>1.1x</span>
          <span>2x</span>
          <span>3x</span>
          <span>4x</span>
        </div>
      </div>

      {/* Animation settings */}
      <div className="border-t border-terminal-border pt-4">
        <h4 className="text-xs font-medium text-terminal-muted uppercase tracking-wider mb-3">Animation</h4>

        {/* Zoom In Duration */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-terminal-muted">Zoom In</label>
            <span className="text-xs text-accent-primary font-medium">
              {zoomInDuration === 0 ? 'Instant' : `${zoomInDuration.toFixed(1)}s`}
            </span>
          </div>
          <Slider
            value={zoomInDuration}
            min={0}
            max={2}
            step={0.1}
            onChange={handleZoomInDurationChange}
            onChangeEnd={saveHistory}
            color="#9B8EC4"
          />
        </div>

        {/* Zoom Out Duration */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-terminal-muted">Zoom Out</label>
            <span className="text-xs text-accent-primary font-medium">
              {zoomOutDuration === 0 ? 'Instant' : `${zoomOutDuration.toFixed(1)}s`}
            </span>
          </div>
          <Slider
            value={zoomOutDuration}
            min={0}
            max={2}
            step={0.1}
            onChange={handleZoomOutDurationChange}
            onChangeEnd={saveHistory}
            color="#9B8EC4"
          />
        </div>
      </div>

      {/* Animation presets */}
      <div>
        <h4 className="text-xs font-medium text-terminal-muted uppercase tracking-wider mb-2">Presets</h4>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              handleZoomInDurationChange(0.3);
              handleZoomOutDurationChange(0.3);
            }}
            className="btn text-xs py-2"
          >
            Quick (0.3s)
          </button>
          <button
            onClick={() => {
              handleZoomInDurationChange(0.5);
              handleZoomOutDurationChange(0.5);
            }}
            className="btn text-xs py-2"
          >
            Smooth (0.5s)
          </button>
          <button
            onClick={() => {
              handleZoomInDurationChange(1);
              handleZoomOutDurationChange(1);
            }}
            className="btn text-xs py-2"
          >
            Slow (1s)
          </button>
          <button
            onClick={() => {
              handleZoomInDurationChange(0);
              handleZoomOutDurationChange(0);
            }}
            className="btn text-xs py-2"
          >
            Instant
          </button>
        </div>
      </div>

      {/* Duration info */}
      <div className="text-xs text-terminal-muted">
        <p>Effect duration: {segment.duration.toFixed(1)}s</p>
        <p>Hold time: {Math.max(0, segment.duration - zoomInDuration - zoomOutDuration).toFixed(1)}s</p>
      </div>
    </div>
  );
}
