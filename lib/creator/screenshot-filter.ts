/**
 * Screenshot detection for the media ingestion pipeline.
 *
 * Filters out screenshots from the media library before they reach the Director Brain.
 * Uses a multi-signal approach — filename patterns, exact device dimensions, and
 * metadata heuristics — to catch screenshots across iPhone, Android, and macOS.
 *
 * Returns true if the file is likely a screenshot.
 */

// ---------------------------------------------------------------------------
// Known screenshot resolutions (width × height, both orientations)
// ---------------------------------------------------------------------------

const SCREENSHOT_RESOLUTIONS = new Set([
  // iPhone 15 Pro Max / 16 Pro Max
  "1290x2796", "2796x1290",
  // iPhone 15 Pro / 16 Pro
  "1179x2556", "2556x1179",
  // iPhone 15 / 16
  "1170x2532", "2532x1170",
  // iPhone 14 Pro Max
  "1290x2796", "2796x1290",
  // iPhone 14 Pro
  "1179x2556", "2556x1179",
  // iPhone 14 / 13 / 12
  "1170x2532", "2532x1170",
  // iPhone 14 Plus / 13 Pro Max / 12 Pro Max
  "1284x2778", "2778x1284",
  // iPhone SE 3
  "750x1334", "1334x750",
  // iPhone 11 / XR
  "828x1792", "1792x828",
  // iPhone 11 Pro Max / XS Max
  "1242x2688", "2688x1242",
  // iPhone 11 Pro / XS / X
  "1125x2436", "2436x1125",
  // iPad Pro 12.9"
  "2048x2732", "2732x2048",
  // iPad Pro 11"
  "1668x2388", "2388x1668",
  // iPad Air / 10.9"
  "1640x2360", "2360x1640",
  // Common Android flagships (Pixel, Samsung)
  "1080x2400", "2400x1080",
  "1080x2340", "2340x1080",
  "1440x3200", "3200x1440",
  "1440x3088", "3088x1440",
  "1080x2460", "2460x1080",
  // macOS common resolutions (Retina)
  "2880x1800", "1800x2880",
  "3024x1964", "1964x3024",
  "3456x2234", "2234x3456",
  "2560x1600", "1600x2560",
  "2560x1440", "1440x2560",
  "1920x1080", "1080x1920",
]);

// ---------------------------------------------------------------------------
// Filename patterns that indicate screenshots
// ---------------------------------------------------------------------------

const SCREENSHOT_FILENAME_PATTERNS = [
  /^screenshot/i,
  /^screen\s?shot/i,
  /^IMG_\d{4}\.(PNG|png)$/,         // iOS screenshots are often PNG
  /^Simulator Screen Shot/i,
  /^Screen Recording/i,
  /^Captura de pantalla/i,           // Spanish
  /^Capture d'écran/i,              // French
  /^Bildschirmfoto/i,               // German
  /^スクリーンショット/,               // Japanese
  /CleanShot/i,                      // CleanShot X (macOS)
  /^Snagit/i,                        // Snagit
  /^chrome_/i,                       // Chrome screenshots
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScreenshotCheckInput {
  filename: string;
  width?: number | null;
  height?: number | null;
  mime_type: string;
  /** EXIF camera make/model — real photos have this, screenshots don't */
  camera_make?: string | null;
  camera_model?: string | null;
}

export interface ScreenshotCheckResult {
  is_screenshot: boolean;
  confidence: number;        // 0-1
  reasons: string[];
}

export function detectScreenshot(input: ScreenshotCheckInput): ScreenshotCheckResult {
  const reasons: string[] = [];
  let score = 0;

  // 1. Filename pattern match (strong signal)
  for (const pattern of SCREENSHOT_FILENAME_PATTERNS) {
    if (pattern.test(input.filename)) {
      reasons.push(`Filename matches screenshot pattern: ${pattern.source}`);
      score += 0.5;
      break;
    }
  }

  // 2. Exact device resolution match (moderate signal for images)
  if (input.width && input.height) {
    const res = `${input.width}x${input.height}`;
    if (SCREENSHOT_RESOLUTIONS.has(res)) {
      // Only counts as a signal for PNG files (screenshots are usually PNG)
      if (input.mime_type === "image/png") {
        reasons.push(`Exact device resolution (${res}) + PNG format`);
        score += 0.4;
      } else {
        // JPEG at exact device resolution is less suspicious (could be a camera photo)
        reasons.push(`Exact device resolution (${res}) but JPEG — might be a photo`);
        score += 0.1;
      }
    }
  }

  // 3. PNG format for "photos" (screenshots are almost always PNG, real photos are JPEG/HEIC)
  if (input.mime_type === "image/png" && !input.filename.toLowerCase().endsWith(".png")) {
    // PNG that doesn't declare itself as PNG — suspicious
    reasons.push("PNG mime type with non-PNG extension");
    score += 0.1;
  }

  // 4. No camera metadata (real photos from cameras/phones always have EXIF camera data)
  if (input.camera_make === null && input.camera_model === null && input.mime_type.startsWith("image/")) {
    reasons.push("No camera make/model in EXIF — not from a camera");
    score += 0.2;
  }

  // 5. PNG from a phone resolution without camera data is almost certainly a screenshot
  if (
    input.mime_type === "image/png" &&
    input.width && input.height &&
    SCREENSHOT_RESOLUTIONS.has(`${input.width}x${input.height}`) &&
    !input.camera_make
  ) {
    reasons.push("PNG + device resolution + no camera data — very likely screenshot");
    score += 0.3;
  }

  // Cap at 1.0
  const confidence = Math.min(1.0, score);

  return {
    is_screenshot: confidence >= 0.5,
    confidence,
    reasons,
  };
}
