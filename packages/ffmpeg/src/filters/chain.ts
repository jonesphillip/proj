import type {
  Project,
  VideoSegment,
  CaptionSegment,
  ZoomEffectSegment,
  AudioSegment,
  SpeedEffect,
  ZoomEffect,
  ZoomKeyframe,
  ExportSettings,
  CaptionStyle,
} from '@proj/shared';

declare const process: { env: Record<string, string | undefined> };
export const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

export const CRF_VALUES: Record<string, number> = { high: 12, medium: 18, low: 24 };
export const PRESETS: Record<string, string> = { high: 'medium', medium: 'fast', low: 'veryfast' };

export interface FFmpegCommand {
  inputs: string[];
  filterComplex: string;
  outputOptions: string[];
  output: string;
}

export function buildTrimFilter(
  segment: VideoSegment,
  inputLabel: string,
  outputLabel: string
): string {
  const start = segment.sourceStart;
  const end = segment.sourceEnd;
  return `[${inputLabel}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[${outputLabel}]`;
}

export function buildSpeedFilter(
  effect: SpeedEffect,
  inputLabel: string,
  outputLabel: string
): string {
  // setpts=PTS/rate makes video faster when rate > 1
  // setpts=PTS*factor makes video slower when factor > 1
  const factor = 1 / effect.rate;
  return `[${inputLabel}]setpts=${factor}*PTS[${outputLabel}]`;
}

export function buildZoomFilter(
  effect: ZoomEffect,
  segmentDuration: number,
  fps: number,
  outputWidth: number,
  outputHeight: number,
  inputLabel: string,
  outputLabel: string
): string {
  const totalFrames = Math.ceil(segmentDuration * fps);

  if (effect.keyframes.length === 0) {
    return `[${inputLabel}]null[${outputLabel}]`;
  }

  if (effect.keyframes.length === 1) {
    // Static zoom
    const kf = effect.keyframes[0];
    return `[${inputLabel}]zoompan=z=${kf.zoom}:x='(iw-iw/zoom)*${kf.x}':y='(ih-ih/zoom)*${kf.y}':d=${totalFrames}:s=${outputWidth}x${outputHeight}:fps=${fps}[${outputLabel}]`;
  }

  // Interpolate between keyframes
  // Sort keyframes by time
  const sortedKeyframes = [...effect.keyframes].sort((a, b) => a.time - b.time);

  // Build zoom expression that interpolates between keyframes
  const zoomExpr = buildKeyframeInterpolation(sortedKeyframes, 'zoom', totalFrames);
  const xExpr = buildKeyframeInterpolation(sortedKeyframes, 'x', totalFrames);
  const yExpr = buildKeyframeInterpolation(sortedKeyframes, 'y', totalFrames);

  // x and y need to account for zoom: x = (iw - iw/zoom) * normalized_x
  const finalX = `(iw-iw/(${zoomExpr}))*(${xExpr})`;
  const finalY = `(ih-ih/(${zoomExpr}))*(${yExpr})`;

  return `[${inputLabel}]zoompan=z='${zoomExpr}':x='${finalX}':y='${finalY}':d=${totalFrames}:s=${outputWidth}x${outputHeight}:fps=${fps}[${outputLabel}]`;
}

// zoompan doesn't work reliably with video, so we use fades instead
export function buildTimelineZoomFilter(
  zoomEffect: ZoomEffectSegment,
  timelineDuration: number,
  fps: number,
  outputWidth: number,
  outputHeight: number,
  inputLabel: string,
  outputLabel: string
): string[] {
  const { startTime, duration, zoom, centerX, centerY } = zoomEffect;
  const zoomInDur = Math.min(zoomEffect.zoomInDuration ?? 0.3, 0.5); // Cap fade duration
  const zoomOutDur = Math.min(zoomEffect.zoomOutDuration ?? 0.3, 0.5);
  const effectEnd = startTime + duration;

  const filters: string[] = [];
  const segments: string[] = [];

  // Scale helpers
  const scaleNormal = `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease,pad=${outputWidth}:${outputHeight}:(ow-iw)/2:(oh-ih)/2`;

  const scaledW = Math.round(outputWidth * zoom);
  const scaledH = Math.round(outputHeight * zoom);
  const cropX = Math.round((scaledW - outputWidth) * centerX);
  const cropY = Math.round((scaledH - outputHeight) * centerY);
  const scaleZoomed = `scale=${scaledW}:${scaledH},crop=${outputWidth}:${outputHeight}:${cropX}:${cropY}`;

  const hasBefore = startTime > 0.05;
  const hasAfter = effectEnd < timelineDuration - 0.05;

  // We need 3 splits: before, during (zoomed), after
  let splitCount = 1; // always have the zoom portion
  if (hasBefore) splitCount++;
  if (hasAfter) splitCount++;

  const splitLabels: string[] = [];
  for (let i = 0; i < splitCount; i++) {
    splitLabels.push(`${outputLabel}_s${i}`);
  }

  if (splitCount > 1) {
    filters.push(`[${inputLabel}]split=${splitCount}${splitLabels.map(l => `[${l}]`).join('')}`);
  } else {
    splitLabels[0] = inputLabel;
  }

  let idx = 0;

  // 1. Before zoom with fade out at end
  if (hasBefore) {
    const label = `${outputLabel}_before`;
    const fadeFrames = Math.round(zoomInDur * fps);
    filters.push(`[${splitLabels[idx++]}]trim=0:${startTime},setpts=PTS-STARTPTS,${scaleNormal},fade=t=out:st=${startTime - zoomInDur}:d=${zoomInDur}[${label}]`);
    segments.push(label);
  }

  // 2. Zoomed portion with fade in at start and fade out at end
  const zoomLabel = `${outputLabel}_zoom`;
  let zoomFilter = `[${splitLabels[idx++]}]trim=${startTime}:${effectEnd},setpts=PTS-STARTPTS,${scaleZoomed}`;
  if (hasBefore) {
    zoomFilter += `,fade=t=in:st=0:d=${zoomInDur}`;
  }
  if (hasAfter) {
    const zoomDur = effectEnd - startTime;
    zoomFilter += `,fade=t=out:st=${zoomDur - zoomOutDur}:d=${zoomOutDur}`;
  }
  zoomFilter += `[${zoomLabel}]`;
  filters.push(zoomFilter);
  segments.push(zoomLabel);

  // 3. After zoom with fade in at start
  if (hasAfter) {
    const label = `${outputLabel}_after`;
    filters.push(`[${splitLabels[idx++]}]trim=${effectEnd},setpts=PTS-STARTPTS,${scaleNormal},fade=t=in:st=0:d=${zoomOutDur}[${label}]`);
    segments.push(label);
  }

  // Concat all segments
  if (segments.length > 1) {
    filters.push(`${segments.map(s => `[${s}]`).join('')}concat=n=${segments.length}:v=1:a=0[${outputLabel}]`);
  } else {
    filters.push(`[${segments[0]}]null[${outputLabel}]`);
  }

  return filters;
}

function buildKeyframeInterpolation(
  keyframes: ZoomKeyframe[],
  property: 'zoom' | 'x' | 'y',
  totalFrames: number
): string {
  if (keyframes.length === 1) {
    return String(keyframes[0][property]);
  }

  // Build piecewise linear interpolation using if() expressions
  let expr = '';

  for (let i = 0; i < keyframes.length - 1; i++) {
    const kf1 = keyframes[i];
    const kf2 = keyframes[i + 1];

    const frame1 = Math.floor(kf1.time * totalFrames);
    const frame2 = Math.floor(kf2.time * totalFrames);
    const val1 = kf1[property];
    const val2 = kf2[property];

    // Linear interpolation: val1 + (val2 - val1) * (on - frame1) / (frame2 - frame1)
    const slope = (val2 - val1) / Math.max(1, frame2 - frame1);
    const segment = `${val1}+${slope}*(on-${frame1})`;

    if (i === 0) {
      expr = `if(lt(on,${frame2}),${segment},`;
    } else if (i === keyframes.length - 2) {
      expr += `${segment})`;
    } else {
      expr += `if(lt(on,${frame2}),${segment},`;
    }
  }

  // Close all the if statements
  for (let i = 0; i < keyframes.length - 2; i++) {
    expr += ')';
  }

  return expr;
}

export function buildScaleFilter(
  width: number,
  height: number,
  inputLabel: string,
  outputLabel: string
): string {
  // Use lanczos scaling for better quality
  return `[${inputLabel}]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2[${outputLabel}]`;
}

export function buildCaptionFilter(
  caption: CaptionSegment,
  style: CaptionStyle,
  inputLabel: string,
  outputLabel: string
): string {
  const { text, startTime, duration } = caption;
  const endTime = startTime + duration;

  // Calculate position
  let x: string;
  let y: string;

  switch (style.position.horizontal) {
    case 'left':
      x = `${style.padding + style.position.offsetX}`;
      break;
    case 'right':
      x = `w-text_w-${style.padding}-${style.position.offsetX}`;
      break;
    case 'center':
    default:
      x = `(w-text_w)/2+${style.position.offsetX}`;
  }

  switch (style.position.vertical) {
    case 'top':
      y = `${style.padding + style.position.offsetY}`;
      break;
    case 'center':
      y = `(h-text_h)/2+${style.position.offsetY}`;
      break;
    case 'bottom':
    default:
      y = `h-text_h-${style.padding}-${style.position.offsetY}`;
  }

  // Escape special characters in text
  const escapedText = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');

  // Convert hex color to ffmpeg format
  const fontColor = style.fontColor.replace('#', '0x');
  const bgColor = style.backgroundColor.replace('#', '');
  const boxColor = `0x${bgColor}@${style.backgroundOpacity}`;

  // Note: FFmpeg drawtext doesn't support rounded corners on the box
  // For rounded corners, would need to use image overlays or ASS subtitles
  return `[${inputLabel}]drawtext=text='${escapedText}':fontsize=${style.fontSize}:fontcolor=${fontColor}:font='Helvetica':x=${x}:y=${y}:box=1:boxcolor=${boxColor}:boxborderw=${style.padding}:enable='between(t,${startTime},${endTime})'[${outputLabel}]`;
}

export interface ExportFilterOptions {
  skipCaptions?: boolean;  // Skip captions (for when zoom is applied after)
  skipZoomEffects?: boolean;  // Skip zoom effects track (handled separately)
}

export function buildExportFilterChain(
  project: Project,
  settings: ExportSettings,
  options: ExportFilterOptions = {}
): FFmpegCommand {
  const { source, timeline } = project;
  const videoSegments = timeline.tracks
    .find(t => t.type === 'video')
    ?.segments.filter((s): s is VideoSegment => s.type === 'video') || [];

  const captionSegments = options.skipCaptions ? [] : (timeline.tracks
    .find(t => t.type === 'caption')
    ?.segments.filter((s): s is CaptionSegment => s.type === 'caption') || []);

  const zoomEffectSegments = options.skipZoomEffects ? [] : (timeline.tracks
    .find(t => t.type === 'effect')
    ?.segments.filter((s): s is ZoomEffectSegment => s.type === 'zoom') || []);

  const filters: string[] = [];
  const segmentOutputs: string[] = [];
  let filterIdx = 0;

  // Check if we need to scale (only if dimensions differ from source)
  const needsScale = settings.width !== source.width || settings.height !== source.height;

  // Process each video segment
  for (let i = 0; i < videoSegments.length; i++) {
    const segment = videoSegments[i];
    let currentLabel = '0:v';
    let nextLabel = `v${filterIdx++}`;

    // 1. Trim
    filters.push(buildTrimFilter(segment, currentLabel, nextLabel));
    currentLabel = nextLabel;

    // 2. Speed (if applied)
    if (segment.effects.speed && segment.effects.speed.rate !== 1) {
      nextLabel = `v${filterIdx++}`;
      filters.push(buildSpeedFilter(segment.effects.speed, currentLabel, nextLabel));
      currentLabel = nextLabel;
    }

    // 3. Zoom (if applied)
    if (segment.effects.zoom && segment.effects.zoom.keyframes.length > 0) {
      nextLabel = `v${filterIdx++}`;
      const adjustedDuration = segment.duration / (segment.effects.speed?.rate || 1);
      filters.push(buildZoomFilter(
        segment.effects.zoom,
        adjustedDuration,
        settings.fps,
        settings.width,
        settings.height,
        currentLabel,
        nextLabel
      ));
      currentLabel = nextLabel;
    }

    // 4. Scale to output dimensions (only if needed)
    if (needsScale) {
      nextLabel = `v${filterIdx++}`;
      filters.push(buildScaleFilter(settings.width, settings.height, currentLabel, nextLabel));
      currentLabel = nextLabel;
    }

    segmentOutputs.push(currentLabel);
  }

  // Concatenate all segments
  let concatOutput = 'vconcat';
  if (segmentOutputs.length > 1) {
    const concatInputs = segmentOutputs.map(l => `[${l}]`).join('');
    filters.push(`${concatInputs}concat=n=${segmentOutputs.length}:v=1:a=0[${concatOutput}]`);
  } else if (segmentOutputs.length === 1) {
    concatOutput = segmentOutputs[0];
  }

  // Apply aspect ratio scale+pad if needed (after concat, before zoom)
  const aspectRatio = settings.aspectRatio || 'source';
  if (aspectRatio !== 'source') {
    const arLabel = `ar${filterIdx++}`;
    filters.push(
      `[${concatOutput}]scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2[${arLabel}]`
    );
    concatOutput = arLabel;
  }

  // Apply zoom effects from effects track
  let zoomOutput = concatOutput;
  if (zoomEffectSegments.length > 0) {
    // For now, apply only the first zoom effect (multiple overlapping zooms are complex)
    for (let i = 0; i < zoomEffectSegments.length; i++) {
      const zoomEffect = zoomEffectSegments[i];
      const nextLabel = `zoom${i}`;
      const zoomFilters = buildTimelineZoomFilter(
        zoomEffect,
        timeline.duration,
        settings.fps,
        settings.width,
        settings.height,
        zoomOutput,
        nextLabel
      );
      filters.push(...zoomFilters);
      zoomOutput = nextLabel;
    }
  }

  // Apply captions on top of zoomed video
  let finalOutput = zoomOutput;
  for (let i = 0; i < captionSegments.length; i++) {
    const caption = captionSegments[i];
    const nextLabel = `cap${i}`;
    filters.push(buildCaptionFilter(
      caption,
      caption.style,
      finalOutput,
      nextLabel
    ));
    finalOutput = nextLabel;
  }

  // Build source audio filter chain (per-segment trim, volume, speed)
  // Only if the source file actually has an audio stream (waveform is non-empty when audio exists)
  const sourceHasAudioStream = (project.source.waveform?.length ?? 0) > 0;
  const hasSourceAudio = sourceHasAudioStream && videoSegments.some(seg => !seg.effects.audioMuted);
  let audioOutput: string | null = null;
  let audioFilterIdx = 0;

  if (hasSourceAudio) {
    const audioSegmentOutputs: string[] = [];

    for (let i = 0; i < videoSegments.length; i++) {
      const segment = videoSegments[i];
      const isMuted = segment.effects.audioMuted ?? false;
      const volume = segment.effects.audioVolume ?? 1.0;

      if (isMuted) {
        // Generate silence for this segment's duration
        const silenceDuration = segment.duration / (segment.effects.speed?.rate || 1);
        const silLabel = `asil${audioFilterIdx++}`;
        filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${silenceDuration}[${silLabel}]`);
        audioSegmentOutputs.push(silLabel);
      } else {
        let currentALabel = '0:a';
        let nextALabel = `a${audioFilterIdx++}`;

        // Trim audio to match video segment
        filters.push(`[${currentALabel}]atrim=start=${segment.sourceStart}:end=${segment.sourceEnd},asetpts=PTS-STARTPTS[${nextALabel}]`);
        currentALabel = nextALabel;

        // Apply volume if not 1.0
        if (volume !== 1.0) {
          nextALabel = `a${audioFilterIdx++}`;
          filters.push(`[${currentALabel}]volume=${volume}[${nextALabel}]`);
          currentALabel = nextALabel;
        }

        // Apply speed (atempo) if speed effect is set
        const speed = segment.effects.speed?.rate;
        if (speed && speed !== 1) {
          // atempo supports 0.5-100, chain multiple for very slow speeds
          let remaining = speed;
          while (remaining > 0 && Math.abs(remaining - 1) > 0.01) {
            const factor = Math.max(0.5, Math.min(100, remaining));
            nextALabel = `a${audioFilterIdx++}`;
            filters.push(`[${currentALabel}]atempo=${factor}[${nextALabel}]`);
            currentALabel = nextALabel;
            remaining = remaining / factor;
            if (factor === remaining) break; // avoid infinite loop
          }
        }

        audioSegmentOutputs.push(currentALabel);
      }
    }

    // Concatenate audio segments
    if (audioSegmentOutputs.length > 1) {
      const aconcatLabel = 'aconcat';
      const aconcatInputs = audioSegmentOutputs.map(l => `[${l}]`).join('');
      filters.push(`${aconcatInputs}concat=n=${audioSegmentOutputs.length}:v=0:a=1[${aconcatLabel}]`);
      audioOutput = aconcatLabel;
    } else if (audioSegmentOutputs.length === 1) {
      audioOutput = audioSegmentOutputs[0];
    }
  }

  const crfValue = CRF_VALUES[settings.quality] ?? 18;
  const preset = PRESETS[settings.quality] ?? 'fast';

  // Build output options using CRF for consistent quality
  const outputOptions = [
    '-map', `[${finalOutput}]`, // Map the final filter output to the video stream
    '-c:v', settings.codec === 'h264' ? 'libx264' : 'libx265',
    '-preset', preset,
    '-crf', `${crfValue}`,
    '-tune', 'film', // Optimized for live-action content
    '-pix_fmt', 'yuv420p',
    ...(audioOutput
      ? ['-map', `[${audioOutput}]`, '-c:a', 'aac', '-b:a', '192k']
      : ['-an']),
    '-movflags', '+faststart',
    // H.264 profile for better compatibility
    '-profile:v', 'high',
    '-level', '4.2',
    // Preserve color information
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
  ];

  return {
    inputs: [source.path],
    filterComplex: filters.join(';'),
    outputOptions,
    output: '', // Will be set by caller
  };
}

export interface CaptionImageInfo {
  path: string;
  width: number;
  height: number;
  startTime: number;
  endTime: number;
  position: {
    x: string;  // FFmpeg expression
    y: string;  // FFmpeg expression
  };
}

export function buildCaptionOverlayFilterChain(
  captionImages: CaptionImageInfo[],
  inputPath: string,
  outputPath: string,
  quality: 'high' | 'medium' | 'low' = 'high'
): { args: string[] } {
  const inputs: string[] = ['-i', inputPath];
  const filters: string[] = [];
  let currentLabel = '0:v';

  // Add each caption image as input
  for (let i = 0; i < captionImages.length; i++) {
    inputs.push('-i', captionImages[i].path);
  }

  // Build overlay chain
  for (let i = 0; i < captionImages.length; i++) {
    const cap = captionImages[i];
    const inputIdx = i + 1;  // Caption images start at input 1
    const nextLabel = `v${i}`;

    // Overlay with enable for timing
    const overlayFilter = `[${currentLabel}][${inputIdx}:v]overlay=${cap.position.x}:${cap.position.y}:enable='between(t,${cap.startTime},${cap.endTime})'[${nextLabel}]`;
    filters.push(overlayFilter);
    currentLabel = nextLabel;
  }

  const crfValue = CRF_VALUES[quality] ?? 18;
  const preset = PRESETS[quality] ?? 'fast';

  const args = [
    FFMPEG_PATH,
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${currentLabel}]`,
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', `${crfValue}`,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-y', outputPath
  ];

  return { args };
}

export function buildProbeCommand(inputPath: string): string[] {
  return [
    FFPROBE_PATH,
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ];
}

export function buildThumbnailCommand(
  inputPath: string,
  outputPath: string,
  time: number,
  width: number = 480
): string[] {
  return [
    FFMPEG_PATH,
    '-ss', `${time}`,
    '-i', inputPath,
    '-vframes', '1',
    '-vf', `scale=${width}:-1`,
    '-y',
    outputPath,
  ];
}

// Build proxy video command (lower res for smooth scrubbing)
export function buildProxyCommand(
  inputPath: string,
  outputPath: string,
  width: number = 640
): string[] {
  return [
    FFMPEG_PATH,
    '-i', inputPath,
    '-vf', `scale=${width}:-1`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '28',
    '-an',
    '-y',
    outputPath,
  ];
}

export function buildFFmpegArgs(cmd: FFmpegCommand): string[] {
  const args: string[] = ['-stats']; // Enable progress output

  // Input files
  for (const input of cmd.inputs) {
    args.push('-i', input);
  }

  // Filter complex
  if (cmd.filterComplex) {
    args.push('-filter_complex', cmd.filterComplex);
  }

  // Output options
  args.push(...cmd.outputOptions);

  // Output file
  args.push('-y', cmd.output);

  return args;
}
