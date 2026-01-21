import { createCanvas } from '@napi-rs/canvas';
import { writeFile } from 'fs/promises';

export interface CaptionImageResult {
  width: number;
  height: number;
  path: string;
  lines: number;
}

export async function generateCaptionPNG(opts: {
  text: string;
  output: string;
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  padding?: number;
  cornerRadius?: number;
  maxWidth?: number;
}): Promise<CaptionImageResult> {
  const fontSize = opts.fontSize ?? 48;
  const fontColor = opts.fontColor ?? '#ffffff';
  const bgColor = opts.backgroundColor ?? '#000000';
  const bgOpacity = opts.backgroundOpacity ?? 0.7;
  const padding = opts.padding ?? 20;
  const cornerRadius = opts.cornerRadius ?? 15;
  const maxWidth = opts.maxWidth ?? 0;

  const font = `${fontSize}px Helvetica, Arial, sans-serif`;

  // Measure text and wrap lines using a temp canvas
  const tmp = createCanvas(1, 1);
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.font = font;

  let lines: string[];
  if (maxWidth > 0) {
    const availableWidth = maxWidth - padding * 2;
    lines = wrapText(tmpCtx, opts.text, availableWidth);
  } else {
    lines = [opts.text];
  }

  const refMetrics = tmpCtx.measureText('Hpg'); // reference chars covering ascent+descent
  const lineHeight = refMetrics.fontBoundingBoxAscent + refMetrics.fontBoundingBoxDescent;
  const fontAscent = refMetrics.fontBoundingBoxAscent;

  const lineWidths = lines.map(line => tmpCtx.measureText(line).width);
  const textWidth = Math.max(...lineWidths);
  const lineSpacing = Math.round(fontSize * 0.3);
  const textHeight = lineHeight * lines.length + lineSpacing * (lines.length - 1);

  const imgWidth = Math.ceil(textWidth) + padding * 2;
  const imgHeight = Math.ceil(textHeight) + padding * 2;

  // Draw the caption image
  const canvas = createCanvas(imgWidth, imgHeight);
  const ctx = canvas.getContext('2d');

  const bgR = parseInt(bgColor.slice(1, 3), 16);
  const bgG = parseInt(bgColor.slice(3, 5), 16);
  const bgB = parseInt(bgColor.slice(5, 7), 16);

  ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},${bgOpacity})`;
  ctx.beginPath();
  ctx.roundRect(0, 0, imgWidth, imgHeight, cornerRadius);
  ctx.fill();

  ctx.fillStyle = fontColor;
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';

  for (let i = 0; i < lines.length; i++) {
    const textX = (imgWidth - lineWidths[i]) / 2;
    const textY = padding + fontAscent + i * (lineHeight + lineSpacing);
    ctx.fillText(lines[i], textX, textY);
  }

  const buf = canvas.toBuffer('image/png');
  await writeFile(opts.output, buf);

  return {
    width: imgWidth,
    height: imgHeight,
    path: opts.output,
    lines: lines.length,
  };
}

export async function generateDynamicIslandPNG(
  screenW: number,
  screenH: number,
  outputPath: string,
): Promise<void> {
  const islandW = Math.round(screenW * 0.30);
  const islandH = Math.max(6, Math.round(screenH * 0.035));
  const islandX = Math.floor((screenW - islandW) / 2);
  const islandY = Math.max(2, Math.round(screenH * 0.01));

  const imgH = islandY + islandH + 2;
  const canvas = createCanvas(screenW, imgH);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.roundRect(islandX, islandY, islandW, islandH, islandH / 2);
  ctx.fill();

  const buf = canvas.toBuffer('image/png');
  await writeFile(outputPath, buf);
}

function wrapText(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine: string[] = [];

  for (const word of words) {
    const testLine = [...currentLine, word].join(' ');
    const lineWidth = ctx.measureText(testLine).width;

    if (lineWidth <= maxWidth) {
      currentLine.push(word);
    } else {
      if (currentLine.length > 0) {
        lines.push(currentLine.join(' '));
      }
      currentLine = [word];
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine.join(' '));
  }

  return lines.length > 0 ? lines : [text];
}
