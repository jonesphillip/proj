import { spawn } from 'bun';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { unlink } from 'fs/promises';
import type { VideoMetadata, VideoSource, AudioSource, Project, ExportProgress, ZoomEffectSegment, OverlaySource, OverlaySegment, AudioSegment, CaptionSegment } from '@proj/shared';
import { DEVICE_FRAME_PRESETS, DEFAULT_CAPTION_STYLE } from '@proj/shared';
import {
  FFMPEG_PATH,
  FFPROBE_PATH,
  buildProbeCommand,
  buildThumbnailCommand,
  buildProxyCommand,
  buildExportFilterChain,
  buildCaptionOverlayFilterChain,
  buildFFmpegArgs,
  type CaptionImageInfo,
} from '@proj/ffmpeg';
import { generateCaptionPNG, generateDynamicIslandPNG } from './image-gen';

interface StepResult {
  success: boolean;
  outputPath: string;
  error?: string;
}

const DATA_DIR = join(import.meta.dir, '../../../../data');
const UPLOADS_DIR = join(DATA_DIR, 'uploads');
const THUMBNAILS_DIR = join(DATA_DIR, 'thumbnails');
const EXPORTS_DIR = join(DATA_DIR, 'exports');

// CRF values for intermediate re-encode passes (overlay, audio mix)
// Slightly higher than the main export CRF since video is already encoded
const INTERMEDIATE_CRF: Record<string, string> = { high: '18', medium: '23', low: '28' };

// Convert relative URL to absolute filesystem path for FFmpeg
export function resolveMediaPath(urlOrPath: string): string {
  if (urlOrPath.startsWith('/uploads/') || urlOrPath.startsWith('/thumbnails/') || urlOrPath.startsWith('/exports/')) {
    return join(DATA_DIR, urlOrPath.slice(1));
  }
  return urlOrPath;
}

export async function extractMetadata(filePath: string): Promise<VideoMetadata> {
  const args = buildProbeCommand(filePath);
  const proc = spawn({
    cmd: args,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const output = await new Response(proc.stdout).text();
  const result = JSON.parse(output);

  const videoStream = result.streams.find((s: any) => s.codec_type === 'video');
  if (!videoStream) {
    throw new Error('No video stream found');
  }

  // Parse fps from frame rate string (e.g., "30/1" or "30000/1001")
  let fps = 30;
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    fps = den ? Math.round(num / den) : num;
  }

  return {
    duration: parseFloat(result.format.duration),
    width: videoStream.width,
    height: videoStream.height,
    fps,
    codec: videoStream.codec_name,
    bitrate: parseInt(result.format.bit_rate, 10) || 0,
  };
}

export async function generateThumbnails(
  filePath: string,
  duration: number,
  count: number = 10
): Promise<string[]> {
  const thumbnails: string[] = [];
  const interval = duration / count;

  for (let i = 0; i < count; i++) {
    const time = i * interval;
    const filename = `${nanoid()}.jpg`;
    const outputPath = join(THUMBNAILS_DIR, filename);

    const args = buildThumbnailCommand(filePath, outputPath, time);
    const proc = spawn({
      cmd: args,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    await proc.exited;
    thumbnails.push(`/thumbnails/${filename}`);
  }

  return thumbnails;
}

export async function generateProxy(
  filePath: string,
  sourceId: string
): Promise<string> {
  const filename = `${sourceId}_proxy.mp4`;
  const outputPath = join(UPLOADS_DIR, filename);

  const args = buildProxyCommand(filePath, outputPath);
  const proc = spawn({
    cmd: args,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await proc.exited;
  return `/uploads/${filename}`;
}

// Track background processing status per source ID
const processingJobs = new Map<string, { status: 'processing' | 'done' | 'error'; result?: Partial<VideoSource>; error?: string }>();

export function getProcessingStatus(sourceId: string) {
  return processingJobs.get(sourceId) ?? null;
}

export async function processUpload(
  file: File
): Promise<VideoSource> {
  const id = nanoid();
  const ext = file.name.split('.').pop() || 'mp4';
  const filename = `${id}.${ext}`;
  const filePath = join(UPLOADS_DIR, filename);

  // Save file to disk
  await Bun.write(filePath, file);

  // Extract metadata (fast — just probes the file header)
  const metadata = await extractMetadata(filePath);

  // Generate one thumbnail synchronously (fast, needed for project list)
  const thumbnails = await generateThumbnails(filePath, metadata.duration, 1);

  // Kick off heavy processing in background (proxy, waveform)
  processingJobs.set(id, { status: 'processing' });
  processUploadBackground(id, filePath, metadata.duration).catch(err => {
    console.error(`Background processing failed for ${id}:`, err);
    processingJobs.set(id, { status: 'error', error: String(err) });
  });

  // Return immediately with metadata + thumbnail — frontend can start editing
  return {
    id,
    filename: file.name,
    path: `/uploads/${filename}`,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    codec: metadata.codec,
    bitrate: metadata.bitrate,
    thumbnails,
  };
}

async function processUploadBackground(
  id: string,
  filePath: string,
  duration: number,
): Promise<void> {
  // Run proxy, waveform, and thumbnails in parallel
  const [proxyPath, waveform, thumbnails] = await Promise.all([
    generateProxy(filePath, id),
    generateWaveformData(filePath),
    generateThumbnails(filePath, duration),
  ]);

  processingJobs.set(id, {
    status: 'done',
    result: { proxyPath, waveform, thumbnails },
  });
}

export async function processOverlayUpload(
  file: File
): Promise<OverlaySource> {
  const id = nanoid();
  const ext = file.name.split('.').pop() || 'mp4';
  const filename = `${id}.${ext}`;
  const filePath = join(UPLOADS_DIR, filename);

  // Save file to disk
  await Bun.write(filePath, file);

  // Extract metadata
  const metadata = await extractMetadata(filePath);

  return {
    id,
    filename: file.name,
    path: `/uploads/${filename}`,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
  };
}

export async function generateWaveformData(
  filePath: string,
  numPeaks: number = 200
): Promise<number[]> {
  // Check if file has an audio stream
  const probeArgs = [
    FFPROBE_PATH, '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath
  ];
  const probeProc = spawn({ cmd: probeArgs, stdout: 'pipe', stderr: 'pipe' });
  const probeOut = await new Response(probeProc.stdout).text();
  if (!probeOut.trim().includes('audio')) {
    return [];
  }

  // Extract raw PCM samples using ffmpeg
  const args = [
    FFMPEG_PATH,
    '-i', filePath,
    '-ac', '1',          // mono
    '-ar', '8000',        // low sample rate for peak extraction
    '-f', 'f32le',        // 32-bit float little-endian
    '-vn',                // no video
    'pipe:1',
  ];

  const proc = spawn({ cmd: args, stdout: 'pipe', stderr: 'pipe' });
  const rawBuffer = await new Response(proc.stdout).arrayBuffer();

  if (rawBuffer.byteLength === 0) return [];

  const samples = new Float32Array(rawBuffer);
  const samplesPerPeak = Math.max(1, Math.floor(samples.length / numPeaks));
  const peaks: number[] = [];

  for (let i = 0; i < numPeaks; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, samples.length);
    let maxAbs = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > maxAbs) maxAbs = abs;
    }
    peaks.push(maxAbs);
  }

  // Normalize to 0-1
  const maxPeak = Math.max(...peaks, 0.001);
  return peaks.map(p => p / maxPeak);
}

export async function processAudioUpload(
  file: File
): Promise<AudioSource> {
  const id = nanoid();
  const ext = file.name.split('.').pop() || 'mp3';
  const filename = `${id}.${ext}`;
  const filePath = join(UPLOADS_DIR, filename);

  await Bun.write(filePath, file);

  // Probe duration
  const probeArgs = [
    FFPROBE_PATH, '-v', 'quiet', '-print_format', 'json',
    '-show_format', filePath
  ];
  const probeProc = spawn({ cmd: probeArgs, stdout: 'pipe', stderr: 'pipe' });
  const probeOutput = await new Response(probeProc.stdout).text();
  const probeResult = JSON.parse(probeOutput);
  const duration = parseFloat(probeResult.format.duration) || 0;

  // Generate waveform
  const waveform = await generateWaveformData(filePath);

  return {
    id,
    filename: file.name,
    path: `/uploads/${filename}`,
    duration,
    waveform,
  };
}

export async function extractFrame(
  filePath: string,
  time: number
): Promise<string> {
  const filename = `frame_${nanoid()}.jpg`;
  const outputPath = join(THUMBNAILS_DIR, filename);

  const args = buildThumbnailCommand(filePath, outputPath, time, 320);
  const proc = spawn({
    cmd: args,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await proc.exited;
  return `/thumbnails/${filename}`;
}

export interface ExportJob {
  id: string;
  project: Project;
  status: ExportProgress['status'];
  progress: number;
  outputPath?: string;
  error?: string;
  fileSize?: number;
}

const exportJobs = new Map<string, ExportJob>();

export function getExportJob(jobId: string): ExportJob | undefined {
  return exportJobs.get(jobId);
}

async function generateCaptionImage(
  caption: CaptionSegment,
  outputPath: string,
  videoWidth: number,
): Promise<CaptionImageInfo | null> {
  const d = DEFAULT_CAPTION_STYLE;
  const style = caption.style ?? d;
  const fontSize = style.fontSize ?? d.fontSize;
  const fontColor = style.fontColor ?? d.fontColor;
  const bgColor = style.backgroundColor ?? d.backgroundColor;
  const bgOpacity = style.backgroundOpacity ?? d.backgroundOpacity;
  const pad = style.padding ?? d.padding;
  const position = style.position ?? d.position;
  const maxCaptionWidth = Math.round(videoWidth * 0.9);

  try {
    const result = await generateCaptionPNG({
      text: caption.text,
      output: outputPath,
      fontSize,
      fontColor,
      backgroundColor: bgColor,
      backgroundOpacity: bgOpacity,
      padding: pad,
      cornerRadius: Math.round(pad * 1.2),
      maxWidth: maxCaptionWidth,
    });

    const offsetX = position.offsetX ?? 0;
    const offsetY = position.offsetY ?? 0;

    let x: string;
    switch (position.horizontal) {
      case 'left':
        x = `${pad + offsetX}`;
        break;
      case 'right':
        x = `W-w-${pad}-${offsetX}`;
        break;
      case 'center':
      default:
        x = `(W-w)/2+${offsetX}`;
    }

    let y: string;
    switch (position.vertical) {
      case 'top':
        y = `${pad + offsetY}`;
        break;
      case 'center':
        y = `(H-h)/2+${offsetY}`;
        break;
      case 'bottom':
      default:
        y = `H-h-${pad}-${offsetY}`;
    }

    return {
      path: outputPath,
      width: result.width,
      height: result.height,
      startTime: caption.startTime,
      endTime: caption.startTime + caption.duration,
      position: { x, y },
    };
  } catch (err) {
    console.error('Caption generation failed:', err);
    return null;
  }
}

// Process zoom effects using FFmpeg crop+scale with smoothstep easing (matches preview)
async function processZoomWithFFmpeg(
  inputPath: string,
  outputPath: string,
  zoomEffect: ZoomEffectSegment,
  outputWidth: number,
  outputHeight: number,
  fps: number,
  onProgress: (step: string) => void,
  sourceWidth?: number,
  sourceHeight?: number,
): Promise<boolean> {
  const { startTime, duration, zoom, centerX, centerY } = zoomEffect;
  const zoomInDur = Math.max(zoomEffect.zoomInDuration ?? 0.3, 0.001);
  const zoomOutDur = Math.max(zoomEffect.zoomOutDuration ?? 0.3, 0.001);
  const effectEnd = startTime + duration;
  const zoomInEnd = startTime + zoomInDur;
  const zoomOutStart = effectEnd - zoomOutDur;
  const halfZoom = zoom - 1;

  // Ensure even dimensions
  const w = outputWidth - (outputWidth % 2);
  const h = outputHeight - (outputHeight % 2);
  const srcW = sourceWidth ?? w;
  const srcH = sourceHeight ?? h;

  // Compute content area within padded frame (letterbox/pillarbox handling)
  const sourceAspect = srcW / srcH;
  const outputAspect = w / h;
  let contentW: number, contentH: number, contentX: number, contentY: number;

  if (Math.abs(sourceAspect - outputAspect) < 0.01) {
    contentW = w;
    contentH = h;
    contentX = 0;
    contentY = 0;
  } else if (sourceAspect > outputAspect) {
    contentW = w;
    contentH = Math.floor(w / sourceAspect);
    contentH = contentH - (contentH % 2);
    contentX = 0;
    contentY = Math.floor((h - contentH) / 2);
  } else {
    contentH = h;
    contentW = Math.floor(h * sourceAspect);
    contentW = contentW - (contentW % 2);
    contentX = Math.floor((w - contentW) / 2);
    contentY = 0;
  }

  // Build zoom level expression Z(time) with smoothstep easing (matches preview)
  // Uses zoompan filter which evaluates expressions per-frame (unlike crop's w/h which are init-only)
  // zoompan uses 'time' variable (seconds), not 't'
  const S = startTime.toFixed(6);
  const E = effectEnd.toFixed(6);
  const ZIN_END = zoomInEnd.toFixed(6);
  const ZIN_DUR = zoomInDur.toFixed(6);
  const ZOUT_START = zoomOutStart.toFixed(6);
  const ZOUT_DUR = zoomOutDur.toFixed(6);
  const Z = zoom.toFixed(6);
  const HZ = halfZoom.toFixed(6);

  // smoothstep(p) = p*p*(3-2*p), using st(0,p) to store and ld(0) to reuse
  const smoothIn = `st(0,min(1,max(0,(time-${S})/${ZIN_DUR})))*0+ld(0)*ld(0)*(3-2*ld(0))`;
  const smoothOut = `st(0,min(1,max(0,(time-${ZOUT_START})/${ZOUT_DUR})))*0+ld(0)*ld(0)*(3-2*ld(0))`;

  const zoomExpr = [
    `if(lt(time,${S}),1,`,
    `if(lt(time,${ZIN_END}),1+${HZ}*(${smoothIn}),`,
    `if(lt(time,${ZOUT_START}),${Z},`,
    `if(lt(time,${E}),${Z}-${HZ}*(${smoothOut}),`,
    `1))))`,
  ].join('');

  // zoompan x/y: top-left of visible region within the input frame
  // x = centerX * iw - iw/(2*zoom), clamped to [0, iw - iw/zoom]
  // y = centerY * ih - ih/(2*zoom), clamped to [0, ih - ih/zoom]
  const xExpr = `max(0,min(${centerX}*iw-iw/zoom/2,iw-iw/zoom))`;
  const yExpr = `max(0,min(${centerY}*ih-ih/zoom/2,ih-ih/zoom))`;

  // Build filter chain: optionally crop content area → zoompan → optionally pad back
  const filterParts: string[] = [];
  const needsContentCrop = contentW !== w || contentH !== h;

  if (needsContentCrop) {
    // Extract content area (static crop), zoom within it, then restore padding
    filterParts.push(`crop=${contentW}:${contentH}:${contentX}:${contentY}`);
  }

  filterParts.push(
    `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${needsContentCrop ? contentW : w}x${needsContentCrop ? contentH : h}:fps=${fps}`,
  );

  if (needsContentCrop) {
    filterParts.push(`pad=${w}:${h}:${contentX}:${contentY}`);
  }

  const filterChain = filterParts.join(',');

  // Get total video duration for progress tracking
  const probeArgs = [FFPROBE_PATH, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath];
  const probeProc = spawn({ cmd: probeArgs, stdout: 'pipe', stderr: 'pipe' });
  const totalDuration = parseFloat(await new Response(probeProc.stdout).text()) || 30;

  const args = [
    FFMPEG_PATH,
    '-y',
    '-stats',
    '-i', inputPath,
    '-vf', filterChain,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-map', '0:a?',
    '-c:a', 'copy',
    outputPath,
  ];

  onProgress('Processing zoom effect...');

  const proc = spawn({
    cmd: args,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Parse progress from stderr
  const decoder = new TextDecoder();
  const stderrReader = proc.stderr.getReader();
  let stderrOutput = '';

  const readStderr = async () => {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      stderrOutput += text;

      const timeMatches = [...text.matchAll(/time=(\d+):(\d+):(\d+)\.(\d+)/g)];
      if (timeMatches.length > 0) {
        const lastMatch = timeMatches[timeMatches.length - 1];
        const currentTime = parseInt(lastMatch[1]) * 3600 + parseInt(lastMatch[2]) * 60 +
          parseInt(lastMatch[3]) + parseInt(lastMatch[4]) / 100;
        const pct = Math.min(99, Math.round((currentTime / totalDuration) * 100));
        onProgress(`Processing zoom: ${pct}%`);
      }
    }
  };
  readStderr();

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error('FFmpeg zoom processing failed:', stderrOutput);
    return false;
  }

  return true;
}

async function applyCaptionOverlay(
  captionSegments: CaptionSegment[],
  currentInputPath: string,
  finalOutputPath: string,
  resolvedProject: Project,
  jobId: string,
  tempDir: string,
  onProgress: (progress: number, step: string) => void
): Promise<StepResult> {
  onProgress(88, 'Generating captions...');

  const captionImages: CaptionImageInfo[] = [];
  const captionTempFiles: string[] = [];

  for (let i = 0; i < captionSegments.length; i++) {
    const caption = captionSegments[i];
    const captionPath = join(tempDir, `caption_${jobId}_${i}.png`);
    captionTempFiles.push(captionPath);

    const imageInfo = await generateCaptionImage(
      caption,
      captionPath,
      resolvedProject.exportSettings.width || resolvedProject.source.width,
    );

    if (imageInfo) {
      captionImages.push(imageInfo);
    }
  }

  if (captionImages.length === 0) {
    return { success: true, outputPath: currentInputPath };
  }

  onProgress(85, 'Applying captions...');

  const { args: captionArgs } = buildCaptionOverlayFilterChain(
    captionImages,
    currentInputPath,
    finalOutputPath,
    resolvedProject.exportSettings.quality
  );

  const captionProc = spawn({
    cmd: captionArgs,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const captionExitCode = await captionProc.exited;

  // Clean up caption temp image files regardless of success
  for (const file of captionTempFiles) {
    try { await unlink(file); } catch { }
  }

  if (captionExitCode !== 0) {
    const captionStderr = await new Response(captionProc.stderr).text();
    console.error('Caption FFmpeg failed:', captionStderr);
    try { await unlink(currentInputPath); } catch { }
    return { success: false, outputPath: currentInputPath, error: 'Failed to apply captions' };
  }

  // Clean up previous input if it differs from the new output
  if (currentInputPath !== finalOutputPath) {
    try { await unlink(currentInputPath); } catch { }
  }

  return { success: true, outputPath: finalOutputPath };
}

async function applyOverlayComposition(
  overlaySegments: OverlaySegment[],
  resolvedProject: Project,
  currentInputPath: string,
  finalOutputPath: string,
  jobId: string,
  tempDir: string,
  onProgress: (progress: number, step: string) => void
): Promise<StepResult> {
  onProgress(90, 'Applying overlay...');

  // Resolve frame PNG paths (they live in packages/web/public/frames/)
  const framesDir = join(import.meta.dir, '../../../web/public');
  let inputPath = currentInputPath;

  for (let i = 0; i < overlaySegments.length; i++) {
    const overlaySeg = overlaySegments[i];
    const overlaySource = resolvedProject.overlaySources?.find(
      (s: OverlaySource) => s.id === overlaySeg.overlaySourceId
    );
    if (!overlaySource) continue;

    const overlayFilePath = resolveMediaPath(overlaySource.path);
    const isLastOverlay = i === overlaySegments.length - 1;
    const overlayOutputPath = isLastOverlay
      ? finalOutputPath
      : join(tempDir, `post_overlay_${jobId}_${i}.mp4`);

    // Get dimensions of current input
    const probeArgs = [FFPROBE_PATH, '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', inputPath];
    const probeProc = spawn({ cmd: probeArgs, stdout: 'pipe', stderr: 'pipe' });
    const probeOutput = await new Response(probeProc.stdout).text();
    const [mainW, mainH] = probeOutput.trim().split(',').map(Number);

    const pos = overlaySeg.position;
    const boxX = Math.round(pos.x * (mainW || 1920));
    const boxY = Math.round(pos.y * (mainH || 1080));

    const trimStart = overlaySeg.sourceStart;
    const trimEnd = overlaySeg.sourceEnd;
    const startTime = overlaySeg.startTime;
    const duration = overlaySeg.duration;

    // Check for device frame
    const deviceFrame = overlaySeg.deviceFrameId
      ? DEVICE_FRAME_PRESETS.find(f => f.id === overlaySeg.deviceFrameId)
      : null;

    // Calculate box dimensions -- when a device frame is active, derive height
    // from width using the frame's exact aspect ratio (same approach as preview)
    let boxW = Math.round(pos.width * (mainW || 1920));
    let boxH: number;
    if (deviceFrame) {
      boxH = Math.round(boxW * deviceFrame.height / deviceFrame.width);
    } else {
      boxH = Math.round(pos.height * (mainH || 1080));
    }
    // FFmpeg YUV formats require even dimensions
    if (boxW % 2 !== 0) boxW += 1;
    if (boxH % 2 !== 0) boxH += 1;

    let filterParts: string[];
    const inputs = ['-i', inputPath, '-i', overlayFilePath];

    if (deviceFrame) {
      // With device frame:
      // 1. Scale overlay video to fit the screen inset within the box
      let screenW = Math.round(boxW * (deviceFrame.screenInset.width / deviceFrame.width));
      let screenH = Math.round(boxH * (deviceFrame.screenInset.height / deviceFrame.height));
      const screenX = Math.round(boxW * (deviceFrame.screenInset.left / deviceFrame.width));
      const screenY = Math.round(boxH * (deviceFrame.screenInset.top / deviceFrame.height));
      // Slightly oversize the video (+2px) to eliminate sub-pixel gaps between video and frame
      screenW += 2;
      screenH += 2;
      if (screenW % 2 !== 0) screenW += 1;
      if (screenH % 2 !== 0) screenH += 1;

      // 2. Scale frame PNG to box size
      const framePath = join(framesDir, deviceFrame.imagePath);
      inputs.push('-i', framePath);

      // 3. Generate Dynamic Island PNG
      const statusBarPath = join(tempDir, `statusbar_${jobId}_${i}.png`);
      await generateDynamicIslandPNG(screenW, screenH, statusBarPath);
      inputs.push('-i', statusBarPath);

      // Compute inner screen corner radius (248px at native 1601-wide screen)
      const innerR = Math.round(screenW * 248 / 1601);
      const w1r = screenW - 1 - innerR;
      const h1r = screenH - 1 - innerR;
      const r2 = innerR * innerR;
      // Rounded rectangle alpha mask: clips video corners to match the frame's screen opening
      const roundClip = `format=yuva420p,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(lte(pow(max(0,max(${innerR}-X,X-${w1r})),2)+pow(max(0,max(${innerR}-Y,Y-${h1r})),2),${r2}),255,0)'`;

      filterParts = [
        // Trim, scale, and clip overlay video corners to match rounded screen opening
        `[1:v]trim=${trimStart}:${trimEnd},setpts=PTS-STARTPTS,scale=${screenW}:${screenH},${roundClip}[ovscaled]`,
        // Scale frame PNG to overlay box size (preserve alpha for transparent corners)
        `[2:v]scale=${boxW}:${boxH},format=yuva420p[framescaled]`,
        // Create transparent base for compositing
        `color=c=black@0:s=${boxW}x${boxH}:d=${duration},format=yuva420p[base]`,
        // Place video inside frame area (offset -1px to center the 2px oversize behind the frame)
        `[base][ovscaled]overlay=${screenX - 1}:${screenY - 1}[withvideo]`,
        // Place Dynamic Island on top of video (at screen inset position)
        `[withvideo][3:v]overlay=${screenX}:${screenY}[withstatusbar]`,
        // Place frame PNG on top (transparent center shows video)
        `[withstatusbar][framescaled]overlay=0:0[composed]`,
        // Place composed overlay onto main video
        `[0:v][composed]overlay=${boxX}:${boxY}:enable='between(t,${startTime},${startTime + duration})'[outv]`,
      ];
    } else {
      // No device frame: simple overlay
      filterParts = [
        `[1:v]trim=${trimStart}:${trimEnd},setpts=PTS-STARTPTS,scale=${boxW}:${boxH}[ovscaled]`,
        `[0:v][ovscaled]overlay=${boxX}:${boxY}:enable='between(t,${startTime},${startTime + duration})'[outv]`,
      ];
    }

    const crf = INTERMEDIATE_CRF[resolvedProject.exportSettings.quality] ?? '23';

    const overlayArgs = [
      FFMPEG_PATH,
      '-y',
      ...inputs,
      '-filter_complex', filterParts.join(';'),
      '-map', '[outv]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', crf,
      '-c:a', 'copy',
      overlayOutputPath,
    ];

    const overlayProc = spawn({
      cmd: overlayArgs,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const overlayExitCode = await overlayProc.exited;

    if (overlayExitCode !== 0) {
      const overlayStderr = await new Response(overlayProc.stderr).text();
      console.error('Overlay FFmpeg failed:', overlayStderr);
      try { await unlink(inputPath); } catch { }
      return { success: false, outputPath: inputPath, error: 'Failed to apply overlay' };
    }

    // Clean up the previous temp file (it has been consumed by this overlay pass)
    if (inputPath !== overlayOutputPath) {
      try { await unlink(inputPath); } catch { }
    }
    inputPath = overlayOutputPath;

    const overlayProgress = 90 + Math.round(((i + 1) / overlaySegments.length) * 8);
    onProgress(overlayProgress, `Overlay ${i + 1}/${overlaySegments.length}`);
  }

  return { success: true, outputPath: inputPath };
}

export async function startExport(
  project: Project,
  jobId: string,
  onProgress: (progress: ExportProgress) => void
): Promise<void> {
  const outputFilename = `${project.id}_${Date.now()}.mp4`;
  const outputPath = join(EXPORTS_DIR, outputFilename);

  // Resolve source path from relative URL to absolute filesystem path
  const resolvedProject = {
    ...project,
    source: {
      ...project.source,
      path: resolveMediaPath(project.source.path),
    },
    overlaySources: (project.overlaySources || []).map((s: OverlaySource) => ({
      ...s,
      path: resolveMediaPath(s.path),
    })),
  };

  const job: ExportJob = {
    id: jobId,
    project: resolvedProject,
    status: 'preparing',
    progress: 0,
  };
  exportJobs.set(jobId, job);

  onProgress({ status: 'preparing', progress: 0, currentStep: 'Preparing export...' });

  // Check for zoom effects, captions, and overlays
  const zoomEffectSegments = resolvedProject.timeline.tracks
    .find(t => t.type === 'effect')
    ?.segments.filter((s): s is ZoomEffectSegment => s.type === 'zoom') || [];

  const captionSegments = resolvedProject.timeline.tracks
    .find(t => t.type === 'caption')
    ?.segments.filter((s): s is CaptionSegment => s.type === 'caption') || [];

  const overlaySegments = resolvedProject.timeline.tracks
    .find(t => t.type === 'overlay')
    ?.segments.filter((s): s is OverlaySegment => s.type === 'overlay') || [];

  const audioSegments = resolvedProject.timeline.tracks
    .find(t => t.type === 'audio')
    ?.segments.filter((s): s is AudioSegment => s.type === 'audio') || [];

  const hasZoomEffects = zoomEffectSegments.length > 0;
  const hasCaptions = captionSegments.length > 0;
  const hasOverlays = overlaySegments.length > 0;
  const hasAudioTrack = audioSegments.length > 0;

  // Ensure temp directory exists
  const tempDir = join(DATA_DIR, 'temp');
  await Bun.write(join(tempDir, '.gitkeep'), '');

  // Pipeline:
  // 1. FFmpeg: trim, speed, scale (always skip captions - handled separately with PNG overlay)
  // 2. FFmpeg: apply zoom via crop+scale expressions (if any)
  // 3. FFmpeg: apply captions with PNG overlay (for rounded corners)
  // 4. FFmpeg: apply overlay video composition (if any)
  const needsIntermediateFile = hasZoomEffects || hasCaptions || hasOverlays;
  const ffmpegOutputPath = needsIntermediateFile
    ? join(tempDir, `pre_effects_${jobId}.mp4`)
    : outputPath;

  // Build FFmpeg command - always skip captions (PNG overlay for rounded corners), skip zoom effects (separate pass)
  const cmd = buildExportFilterChain(resolvedProject, resolvedProject.exportSettings, {
    skipCaptions: true,  // Always skip - PNG overlay gives rounded corners
    skipZoomEffects: true,  // Always skip - handled by separate FFmpeg zoom pass
  });
  cmd.output = ffmpegOutputPath;

  const args = [FFMPEG_PATH, ...buildFFmpegArgs(cmd)];

  onProgress({ status: 'preparing', progress: 5, currentStep: 'Building filter chain' });

  // Start ffmpeg process
  const proc = spawn({
    cmd: args,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  job.status = 'processing';

  // Parse progress from stderr
  const decoder = new TextDecoder();
  const reader = proc.stderr.getReader();
  let progressBuffer = '';

  const readProgress = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      progressBuffer += decoder.decode(value, { stream: true });

      // Parse time from ffmpeg output - find all matches and use the last one
      const timeMatches = [...progressBuffer.matchAll(/time=(\d+):(\d+):(\d+)\.(\d+)/g)];
      if (timeMatches.length > 0) {
        const lastMatch = timeMatches[timeMatches.length - 1];
        const hours = parseInt(lastMatch[1], 10);
        const minutes = parseInt(lastMatch[2], 10);
        const seconds = parseInt(lastMatch[3], 10);
        const centiseconds = parseInt(lastMatch[4], 10);
        const currentTime = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
        const totalDuration = resolvedProject.timeline.duration;

        // Progress: 5-60% for FFmpeg encoding if zoom, captions, or overlays need separate pass
        const maxProgress = (hasZoomEffects || hasCaptions || hasOverlays) ? 60 : 90;
        const encodingProgress = 5 + Math.min(maxProgress - 5, Math.round((currentTime / totalDuration) * (maxProgress - 5)));
        const progress = encodingProgress;

        // Only update if progress changed
        if (progress !== job.progress) {
          job.progress = progress;
          const step = encodingProgress >= 90 ? 'Finalizing...' : `Encoding: ${Math.round((currentTime / totalDuration) * 100)}%`;
          onProgress({
            status: 'processing',
            progress,
            currentStep: step,
          });
        }

        // Keep buffer manageable - only keep last 1000 chars
        if (progressBuffer.length > 2000) {
          progressBuffer = progressBuffer.slice(-1000);
        }
      }
    }
  };

  readProgress();

  const exitCode = await proc.exited;

  if (exitCode === 0) {
    let currentInputPath = ffmpegOutputPath;

    // Step 2: If we have zoom effects, apply them now
    if (hasZoomEffects && zoomEffectSegments.length > 0) {
      onProgress({ status: 'processing', progress: 65, currentStep: 'Applying zoom effects...' });

      const zoomEffect = zoomEffectSegments[0];

      // Get dimensions from the pre-effects file
      const probeArgs = [FFPROBE_PATH, '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ffmpegOutputPath];
      const probeProc = spawn({ cmd: probeArgs, stdout: 'pipe', stderr: 'pipe' });
      const probeOutput = await new Response(probeProc.stdout).text();
      const [width, height] = probeOutput.trim().split(',').map(Number);

      // If we need captions or overlays after, zoom goes to temp; otherwise to final output
      const zoomOutputPath = (hasCaptions || hasOverlays)
        ? join(tempDir, `post_zoom_${jobId}.mp4`)
        : outputPath;

      const zoomSuccess = await processZoomWithFFmpeg(
        ffmpegOutputPath,
        zoomOutputPath,
        zoomEffect,
        width || resolvedProject.exportSettings.width || 1920,
        height || resolvedProject.exportSettings.height || 1080,
        resolvedProject.exportSettings.fps || 30,
        (step) => {
          const match = step.match(/(\d+)%/);
          if (match) {
            const pct = parseInt(match[1], 10);
            const scaledProgress = (hasCaptions || hasOverlays) ? 65 + Math.round(pct * 0.15) : 65 + Math.round(pct * 0.3);
            onProgress({ status: 'processing', progress: scaledProgress, currentStep: step });
          }
        },
        resolvedProject.source.width,
        resolvedProject.source.height,
      );

      // Clean up pre-effects temp file
      try { await unlink(ffmpegOutputPath); } catch { }

      if (!zoomSuccess) {
        job.status = 'error';
        job.error = 'Failed to apply zoom effect';
        onProgress({ status: 'error', progress: 0, error: job.error });
        return;
      }

      currentInputPath = zoomOutputPath;
    }

    // Step 3: Apply overlay video composition (before captions so captions render on top)
    if (hasOverlays && overlaySegments.length > 0) {
      const overlayOutputPath = hasCaptions
        ? join(tempDir, `post_overlay_${jobId}.mp4`)
        : outputPath;

      const overlayResult = await applyOverlayComposition(
        overlaySegments,
        resolvedProject,
        currentInputPath,
        overlayOutputPath,
        jobId,
        tempDir,
        (progress, step) => onProgress({ status: 'processing', progress, currentStep: step })
      );

      if (!overlayResult.success) {
        job.status = 'error';
        job.error = overlayResult.error ?? 'Failed to apply overlay';
        onProgress({ status: 'error', progress: 0, error: job.error });
        return;
      }
      currentInputPath = overlayResult.outputPath;
    }

    // Step 4: Apply captions with PNG overlay (after overlays so captions render on top)
    if (hasCaptions && captionSegments.length > 0) {
      const captionResult = await applyCaptionOverlay(
        captionSegments,
        currentInputPath,
        outputPath,
        resolvedProject,
        jobId,
        tempDir,
        (progress, step) => onProgress({ status: 'processing', progress, currentStep: step })
      );

      if (!captionResult.success) {
        job.status = 'error';
        job.error = captionResult.error ?? 'Failed to apply captions';
        onProgress({ status: 'error', progress: 0, error: job.error });
        return;
      }
      currentInputPath = captionResult.outputPath;
    }

    // Step 5: Mix in audio track segments (background music)
    if (hasAudioTrack && audioSegments.length > 0) {
      onProgress({ status: 'processing', progress: 95, currentStep: 'Mixing audio tracks...' });

      const audioMixOutput = join(tempDir, `post_audiomix_${jobId}.mp4`);
      const audioInputs: string[] = ['-i', currentInputPath];
      const audioFilters: string[] = [];
      let audioIdx = 1;

      for (const audioSeg of audioSegments) {
        const audioSource = (resolvedProject.audioSources || []).find(
          s => s.id === audioSeg.audioSourceId
        );
        if (!audioSource || audioSeg.muted) continue;

        const audioFilePath = resolveMediaPath(audioSource.path);
        audioInputs.push('-i', audioFilePath);

        // Build per-segment audio filter: trim, volume, fade, delay
        let aLabel = `${audioIdx}:a`;
        let nextLabel = `bg${audioIdx}_0`;

        // Trim to source range
        audioFilters.push(`[${aLabel}]atrim=start=${audioSeg.sourceStart}:end=${audioSeg.sourceEnd},asetpts=PTS-STARTPTS[${nextLabel}]`);
        aLabel = nextLabel;

        // Apply volume
        if (audioSeg.volume !== 1.0) {
          nextLabel = `bg${audioIdx}_1`;
          audioFilters.push(`[${aLabel}]volume=${audioSeg.volume}[${nextLabel}]`);
          aLabel = nextLabel;
        }

        // Apply fade in
        if (audioSeg.fadeInDuration > 0) {
          nextLabel = `bg${audioIdx}_2`;
          audioFilters.push(`[${aLabel}]afade=t=in:st=0:d=${audioSeg.fadeInDuration}[${nextLabel}]`);
          aLabel = nextLabel;
        }

        // Apply fade out
        if (audioSeg.fadeOutDuration > 0) {
          const segDur = audioSeg.sourceEnd - audioSeg.sourceStart;
          nextLabel = `bg${audioIdx}_3`;
          audioFilters.push(`[${aLabel}]afade=t=out:st=${segDur - audioSeg.fadeOutDuration}:d=${audioSeg.fadeOutDuration}[${nextLabel}]`);
          aLabel = nextLabel;
        }

        // Delay to the correct timeline position
        if (audioSeg.startTime > 0) {
          nextLabel = `bg${audioIdx}_4`;
          const delayMs = Math.round(audioSeg.startTime * 1000);
          audioFilters.push(`[${aLabel}]adelay=${delayMs}|${delayMs}[${nextLabel}]`);
          aLabel = nextLabel;
        }

        audioFilters.push(`[${aLabel}]apad[bgfinal${audioIdx}]`);
        audioIdx++;
      }

      const bgCount = audioIdx - 1;
      if (bgCount > 0) {
        // Check if the intermediate video has an audio stream to mix with
        const probeArgs = [FFPROBE_PATH, '-v', 'error', '-select_streams', 'a:0',
          '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', currentInputPath];
        const probeProc = spawn({ cmd: probeArgs, stdout: 'pipe', stderr: 'pipe' });
        const probeOut = await new Response(probeProc.stdout).text();
        const videoHasAudio = probeOut.trim().includes('audio');

        if (videoHasAudio) {
          // Mix: source audio (0:a) + all background audio
          const mixInputs = ['[0:a]', ...Array.from({ length: bgCount }, (_, i) => `[bgfinal${i + 1}]`)];
          audioFilters.push(`${mixInputs.join('')}amix=inputs=${bgCount + 1}:duration=first:dropout_transition=2[amixed]`);
        } else if (bgCount === 1) {
          // No source audio, single background track — use it directly
          audioFilters.push(`[bgfinal1]atrim=0:${resolvedProject.timeline.duration}[amixed]`);
        } else {
          // No source audio, multiple background tracks — mix them together
          const mixInputs = Array.from({ length: bgCount }, (_, i) => `[bgfinal${i + 1}]`);
          audioFilters.push(`${mixInputs.join('')}amix=inputs=${bgCount}:duration=longest:dropout_transition=2[amixed]`);
        }

        const mixArgs = [
          FFMPEG_PATH, '-y',
          ...audioInputs,
          '-filter_complex', audioFilters.join(';'),
          '-map', '0:v',
          '-map', '[amixed]',
          '-c:v', 'copy',
          '-c:a', 'aac', '-b:a', '192k',
          '-shortest',
          audioMixOutput,
        ];

        const mixProc = spawn({ cmd: mixArgs, stdout: 'pipe', stderr: 'pipe' });
        const mixExitCode = await mixProc.exited;

        if (mixExitCode === 0) {
          // Replace the current output with the mixed version
          if (currentInputPath !== outputPath) {
            try { await unlink(currentInputPath); } catch { }
          }
          // Move mixed output to final location
          const fs = await import('fs/promises');
          await fs.rename(audioMixOutput, outputPath);
          currentInputPath = outputPath;
        } else {
          const mixStderr = await new Response(mixProc.stderr).text();
          console.error('Audio mix failed (continuing without background audio):', mixStderr);
          // Don't fail the export, just skip audio mixing
        }
      }
    }

    job.status = 'complete';
    job.progress = 100;
    job.outputPath = `/exports/${outputFilename}`;

    const outputFile = Bun.file(outputPath);
    job.fileSize = outputFile.size;

    onProgress({
      status: 'complete',
      progress: 100,
      outputPath: job.outputPath,
    });
  } else {
    console.error('FFmpeg export failed with exit code:', exitCode);

    job.status = 'error';
    job.error = `FFmpeg export failed (exit code ${exitCode}): ${progressBuffer.slice(-500)}`;
    onProgress({
      status: 'error',
      progress: job.progress,
      error: job.error,
    });
  }
}
