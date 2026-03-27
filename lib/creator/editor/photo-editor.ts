/**
 * Photo editor — Sharp-based photo editing driven by EditPlan JSON.
 *
 * Handles: crop, color grading, text overlays, basic enhancement.
 * Sharp is the Node.js standard for image manipulation — fast, memory-efficient,
 * and runs in serverless functions without issues.
 */

import type { PhotoEdits } from "@/lib/creator/director";
import { logInfo } from "@/lib/logger";

// We dynamically import sharp to avoid issues in environments where it's not available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharpFn: ((input: Buffer | string) => any) | null = null;

async function getSharp() {
  if (!sharpFn) {
    const mod = await import("sharp");
    sharpFn = mod.default;
  }
  return sharpFn!;
}

// ---------------------------------------------------------------------------
// Aspect ratio helpers
// ---------------------------------------------------------------------------

const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  "1:1": { w: 1, h: 1 },
  "4:5": { w: 4, h: 5 },
  "9:16": { w: 9, h: 16 },
  "16:9": { w: 16, h: 9 },
};

function computeCrop(
  srcWidth: number,
  srcHeight: number,
  targetRatio: string,
  focusPoint?: { x: number; y: number }
): { left: number; top: number; width: number; height: number } {
  const ratio = ASPECT_RATIOS[targetRatio];
  if (!ratio) return { left: 0, top: 0, width: srcWidth, height: srcHeight };

  const targetAspect = ratio.w / ratio.h;
  const srcAspect = srcWidth / srcHeight;

  let cropWidth: number;
  let cropHeight: number;

  if (srcAspect > targetAspect) {
    // Source is wider — crop sides
    cropHeight = srcHeight;
    cropWidth = Math.round(srcHeight * targetAspect);
  } else {
    // Source is taller — crop top/bottom
    cropWidth = srcWidth;
    cropHeight = Math.round(srcWidth / targetAspect);
  }

  // Center crop by default, offset toward focus point if provided
  let left = Math.round((srcWidth - cropWidth) / 2);
  let top = Math.round((srcHeight - cropHeight) / 2);

  if (focusPoint) {
    // Focus point is 0-1 relative to image dimensions
    const focusX = Math.round(focusPoint.x * srcWidth);
    const focusY = Math.round(focusPoint.y * srcHeight);

    left = Math.max(0, Math.min(srcWidth - cropWidth, focusX - cropWidth / 2));
    top = Math.max(0, Math.min(srcHeight - cropHeight, focusY - cropHeight / 2));
  }

  return { left, top, width: cropWidth, height: cropHeight };
}

// ---------------------------------------------------------------------------
// Color grading presets (applied via Sharp modulate + tint)
// ---------------------------------------------------------------------------

interface ColorPreset {
  brightness?: number;
  saturation?: number;
  hue?: number;
  // Sharp linear: a * input + b (per channel)
  linear?: { a?: number; b?: number };
  tint?: { r: number; g: number; b: number };
  gamma?: number;
}

const COLOR_PRESETS: Record<string, ColorPreset> = {
  warm: {
    brightness: 1.05,
    saturation: 1.1,
    tint: { r: 255, g: 220, b: 180 },
    gamma: 1.1,
  },
  cool: {
    brightness: 1.02,
    saturation: 0.95,
    tint: { r: 180, g: 210, b: 255 },
    gamma: 0.95,
  },
  moody: {
    brightness: 0.9,
    saturation: 0.8,
    gamma: 1.3,     // lift blacks
    linear: { a: 0.9, b: 15 },  // slight fade
  },
  bright: {
    brightness: 1.15,
    saturation: 1.15,
    gamma: 0.85,
  },
  film: {
    brightness: 0.98,
    saturation: 0.85,
    gamma: 1.2,
    linear: { a: 0.85, b: 20 },  // faded blacks
    tint: { r: 240, g: 230, b: 210 },
  },
};

// ---------------------------------------------------------------------------
// Main photo edit executor
// ---------------------------------------------------------------------------

export interface PhotoEditInput {
  imageBuffer: Buffer;
  edits: PhotoEdits;
  srcWidth: number;
  srcHeight: number;
}

export interface PhotoEditResult {
  buffer: Buffer;
  width: number;
  height: number;
  mime_type: string;
}

export async function executePhotoEdit(input: PhotoEditInput): Promise<PhotoEditResult> {
  const sharpLib = await getSharp();
  let image = sharpLib(input.imageBuffer);
  let currentWidth = input.srcWidth;
  let currentHeight = input.srcHeight;

  // 1. Crop
  if (input.edits.crop) {
    const crop = computeCrop(
      currentWidth,
      currentHeight,
      input.edits.crop.aspect_ratio,
      input.edits.crop.focus_point
    );
    image = image.extract(crop);
    currentWidth = crop.width;
    currentHeight = crop.height;
    logInfo("photo-editor.crop", { ratio: input.edits.crop.aspect_ratio, result: `${crop.width}x${crop.height}` });
  }

  // 2. Color grading
  if (input.edits.color_grade && input.edits.color_grade.preset !== "none") {
    const preset = COLOR_PRESETS[input.edits.color_grade.preset];
    if (preset) {
      // Apply modulate (brightness, saturation, hue)
      const modulate: { brightness?: number; saturation?: number; hue?: number } = {};
      if (preset.brightness) modulate.brightness = preset.brightness;
      if (preset.saturation) modulate.saturation = preset.saturation;
      if (preset.hue) modulate.hue = preset.hue;
      if (Object.keys(modulate).length > 0) {
        image = image.modulate(modulate);
      }

      // Apply gamma (lifts or crushes shadows)
      if (preset.gamma) {
        image = image.gamma(preset.gamma);
      }

      // Apply linear (fade effect)
      if (preset.linear) {
        image = image.linear(preset.linear.a ?? 1, preset.linear.b ?? 0);
      }

      // Apply tint (color cast)
      if (preset.tint) {
        image = image.tint(preset.tint);
      }
    }

    // Apply manual overrides on top of preset
    const manual = input.edits.color_grade;
    const overrides: { brightness?: number; saturation?: number } = {};
    if (manual.brightness !== undefined) {
      overrides.brightness = 1 + manual.brightness / 100;
    }
    if (manual.saturation !== undefined) {
      overrides.saturation = 1 + manual.saturation / 100;
    }
    if (Object.keys(overrides).length > 0) {
      image = image.modulate(overrides);
    }

    logInfo("photo-editor.color-grade", { preset: input.edits.color_grade.preset });
  }

  // 3. Text overlay
  if (input.edits.text_overlay) {
    const overlay = input.edits.text_overlay;
    const fontSize = Math.round(currentWidth * 0.04); // 4% of width
    const padding = Math.round(currentWidth * 0.05);

    // Create text SVG overlay
    const isBold = overlay.style === "bold";
    const fontWeight = isBold ? "bold" : "normal";
    const bgOpacity = overlay.style === "subtitle" ? 0.6 : 0;

    const yPosition =
      overlay.position === "top" ? padding + fontSize :
      overlay.position === "bottom" ? currentHeight - padding :
      currentHeight / 2;

    const svgText = `
      <svg width="${currentWidth}" height="${currentHeight}">
        ${bgOpacity > 0 ? `
          <rect x="0" y="${yPosition - fontSize - 10}" width="${currentWidth}" height="${fontSize + 30}"
                fill="black" fill-opacity="${bgOpacity}" />
        ` : ""}
        <text x="${currentWidth / 2}" y="${yPosition}"
              font-family="Arial, Helvetica, sans-serif"
              font-size="${fontSize}" font-weight="${fontWeight}"
              fill="white" text-anchor="middle"
              stroke="black" stroke-width="${Math.max(1, fontSize * 0.03)}"
              paint-order="stroke">
          ${escapeXml(overlay.text)}
        </text>
      </svg>
    `;

    image = image.composite([{ input: Buffer.from(svgText), gravity: "centre" }]);
    logInfo("photo-editor.text-overlay", { text: overlay.text, position: overlay.position });
  }

  // 4. Output as JPEG (best balance of quality/size for social media)
  const outputBuffer = await image
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const metadata = await sharpLib(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    width: metadata.width ?? currentWidth,
    height: metadata.height ?? currentHeight,
    mime_type: "image/jpeg",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
