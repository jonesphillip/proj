import { useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { Slider } from '../ui/Slider';
import type { CaptionSegment, CaptionPosition } from '@proj/shared';

interface CaptionEditorProps {
  segment: CaptionSegment;
}

export function CaptionEditor({ segment }: CaptionEditorProps) {
  const { updateCaptionText, updateCaptionStyle, saveHistory } = useTimelineStore();

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateCaptionText(segment.id, e.target.value);
  }, [segment.id, updateCaptionText]);

  const handleFontSizeChange = useCallback((fontSize: number) => {
    updateCaptionStyle(segment.id, { fontSize });
  }, [segment.id, updateCaptionStyle]);

  const handleFontColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateCaptionStyle(segment.id, { fontColor: e.target.value });
  }, [segment.id, updateCaptionStyle]);

  const handleBgColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateCaptionStyle(segment.id, { backgroundColor: e.target.value });
  }, [segment.id, updateCaptionStyle]);

  const handleBgOpacityChange = useCallback((backgroundOpacity: number) => {
    updateCaptionStyle(segment.id, { backgroundOpacity });
  }, [segment.id, updateCaptionStyle]);

  const handleVerticalPositionChange = useCallback((vertical: CaptionPosition['vertical']) => {
    updateCaptionStyle(segment.id, {
      position: { ...segment.style.position, vertical },
    });
  }, [segment.id, segment.style.position, updateCaptionStyle]);

  const handleHorizontalPositionChange = useCallback((horizontal: CaptionPosition['horizontal']) => {
    updateCaptionStyle(segment.id, {
      position: { ...segment.style.position, horizontal },
    });
  }, [segment.id, segment.style.position, updateCaptionStyle]);

  return (
    <div className="space-y-4">
      {/* Text section */}
      <div>
        <h4 className="text-xs font-medium text-terminal-muted uppercase tracking-wider mb-3">Text</h4>
        <textarea
          value={segment.text}
          onChange={handleTextChange}
          onBlur={() => saveHistory()}
          className="input w-full h-20 resize-none text-sm"
          placeholder="Enter caption text..."
        />
      </div>

      {/* Position section */}
      <div className="border-t border-terminal-border pt-4">
        <h4 className="text-xs font-medium text-terminal-muted uppercase tracking-wider mb-3">Position</h4>

        {/* Vertical */}
        <div className="flex gap-1 mb-2">
          {(['top', 'center', 'bottom'] as const).map(pos => (
            <button
              key={pos}
              onClick={() => handleVerticalPositionChange(pos)}
              className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
                segment.style.position.vertical === pos
                  ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                  : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
              }`}
            >
              {pos}
            </button>
          ))}
        </div>

        {/* Horizontal */}
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map(pos => (
            <button
              key={pos}
              onClick={() => handleHorizontalPositionChange(pos)}
              className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
                segment.style.position.horizontal === pos
                  ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                  : 'border-terminal-border text-terminal-muted hover:border-terminal-muted'
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      {/* Style section */}
      <div className="border-t border-terminal-border pt-4">
        <h4 className="text-xs font-medium text-terminal-muted uppercase tracking-wider mb-3">Style</h4>

        {/* Font size */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-terminal-muted">Font Size</label>
            <span className="text-xs text-accent-primary font-medium">{segment.style.fontSize}px</span>
          </div>
          <Slider
            value={segment.style.fontSize}
            min={24}
            max={144}
            step={4}
            onChange={handleFontSizeChange}
            onChangeEnd={saveHistory}
            color="#9B8EC4"
          />
        </div>

        {/* Colors */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-xs text-terminal-muted block mb-1">Text Color</label>
            <input
              type="color"
              value={segment.style.fontColor}
              onChange={handleFontColorChange}
              className="w-full h-8 rounded border border-terminal-border cursor-pointer"
            />
          </div>
          <div>
            <label className="text-xs text-terminal-muted block mb-1">Background</label>
            <input
              type="color"
              value={segment.style.backgroundColor}
              onChange={handleBgColorChange}
              className="w-full h-8 rounded border border-terminal-border cursor-pointer"
            />
          </div>
        </div>

        {/* Background opacity */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-terminal-muted">Background Opacity</label>
            <span className="text-xs text-accent-primary font-medium">{Math.round(segment.style.backgroundOpacity * 100)}%</span>
          </div>
          <Slider
            value={segment.style.backgroundOpacity}
            min={0}
            max={1}
            step={0.1}
            onChange={handleBgOpacityChange}
            onChangeEnd={saveHistory}
            color="#9B8EC4"
          />
        </div>
      </div>
    </div>
  );
}
