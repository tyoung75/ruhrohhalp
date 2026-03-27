/**
 * Video editor — FFmpeg-based video editing driven by EditPlan JSON.
 *
 * Uses fluent-ffmpeg with ffmpeg-static for serverless-compatible video processing.
 * Handles: trim, combine clips, transitions, text overlays, color grading via LUTs,
 * speed changes, aspect ratio conversion.
 *
 * For Vercel: runs in background jobs (Trigger.dev or similar) due to timeout constraints.
 */

import { spawn } from "child_process";
import { writeFile, unlink, mkdtemp, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { VideoEdits } from "@/lib/creator/director";
import { logInfo, logError } from "@/lib/logger";

// ---------------------------------------------------------------------------
// FFmpeg binary resolution
// ---------------------------------------------------------------------------

let ffmpegPath: string = "ffmpeg"; // fallback to system ffmpeg

try {
  // Try to use ffmpeg-static if available
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ffmpegPath = require("ffmpeg-static") as string;
} catch {
  // Fall back to system ffmpeg
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoEditInput {
  /** Map of asset_id → { buffer, mime_type, filename } */
  assets: Map<string, { buffer: Buffer; mime_type: string; filename: string }>;
  edits: VideoEdits;
}

export interface VideoEditResult {
  buffer: Buffer;
  mime_type: string;
  duration_seconds: number;
}

// ---------------------------------------------------------------------------
// FFmpeg execution helper
// ---------------------------------------------------------------------------

function runFFmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Aspect ratio → FFmpeg crop/pad filter
// ---------------------------------------------------------------------------

const ASPECT_RATIO_FILTERS: Record<string, string> = {
  "9:16": "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920",
  "16:9": "crop=iw:iw*9/16:0:(ih-iw*9/16)/2,scale=1920:1080",
  "1:1": "crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2,scale=1080:1080",
};

// ---------------------------------------------------------------------------
// LUT-based color grading
// ---------------------------------------------------------------------------

const LUT_PRESETS: Record<string, string> = {
  warm: "colorbalance=rs=0.1:gs=0.05:bs=-0.05:rm=0.05:gm=0.02:bm=-0.02,eq=brightness=0.05:saturation=1.1",
  cool: "colorbalance=rs=-0.05:gs=0:bs=0.1:rm=-0.03:gm=0:bm=0.05,eq=saturation=0.95",
  moody: "eq=brightness=-0.05:saturation=0.8:gamma=1.3,colorbalance=rs=0:gs=-0.02:bs=0.03",
  bright: "eq=brightness=0.1:saturation=1.15:gamma=0.85",
  film: "eq=brightness=-0.02:saturation=0.85:gamma=1.2,colorbalance=rs=0.03:gs=0.02:bs=-0.02",
};

// ---------------------------------------------------------------------------
// Main video edit executor
// ---------------------------------------------------------------------------

export async function executeVideoEdit(input: VideoEditInput): Promise<VideoEditResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), "editor-"));
  const inputFiles: string[] = [];
  const cleanupFiles: string[] = [];

  try {
    // Write input assets to temp files
    let idx = 0;
    for (const [assetId, asset] of input.assets) {
      const ext = asset.mime_type === "video/mp4" ? ".mp4" :
                  asset.mime_type === "video/quicktime" ? ".mov" : ".mp4";
      const path = join(tmpDir, `input_${idx}_${assetId.slice(0, 8)}${ext}`);
      await writeFile(path, asset.buffer);
      inputFiles.push(path);
      cleanupFiles.push(path);
      idx++;
    }

    const outputPath = join(tmpDir, "output.mp4");
    cleanupFiles.push(outputPath);

    const ffmpegArgs: string[] = ["-y"]; // overwrite output
    const filters: string[] = [];

    // Handle different edit scenarios
    if (input.edits.segments && input.edits.segments.length > 1) {
      // Multi-clip combine
      await combineClips(input, inputFiles, outputPath, tmpDir, cleanupFiles);
    } else {
      // Single file edit
      const inputFile = inputFiles[0];
      if (!inputFile) throw new Error("No input files");

      ffmpegArgs.push("-i", inputFile);

      // Trim
      if (input.edits.trim) {
        ffmpegArgs.splice(1, 0,
          "-ss", input.edits.trim.start_seconds.toString(),
          "-to", input.edits.trim.end_seconds.toString()
        );
      }

      // Speed
      if (input.edits.speed?.factor && input.edits.speed.factor !== 1) {
        const pts = 1 / input.edits.speed.factor;
        filters.push(`setpts=${pts}*PTS`);
        // Adjust audio speed too
        filters.push(`atempo=${input.edits.speed.factor}`);
      }

      // Color grade
      if (input.edits.color_grade?.preset) {
        const lutFilter = LUT_PRESETS[input.edits.color_grade.preset];
        if (lutFilter) filters.push(lutFilter);
      }

      // Aspect ratio
      if (input.edits.output_format?.aspect_ratio) {
        const arFilter = ASPECT_RATIO_FILTERS[input.edits.output_format.aspect_ratio];
        if (arFilter) filters.push(arFilter);
      }

      // Text overlays
      if (input.edits.text_overlays?.length) {
        for (const overlay of input.edits.text_overlays) {
          const escapedText = overlay.text.replace(/'/g, "\\'").replace(/:/g, "\\:");
          const yPos = overlay.position === "top" ? "h*0.1" :
                       overlay.position === "bottom" ? "h*0.85" : "h*0.5";
          filters.push(
            `drawtext=text='${escapedText}':fontsize=h*0.04:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=${yPos}:enable='between(t\\,${overlay.start}\\,${overlay.end})'`
          );
        }
      }

      // Build filter chain
      if (filters.length > 0) {
        // Separate video and audio filters
        const videoFilters = filters.filter((f) => !f.startsWith("atempo"));
        const audioFilters = filters.filter((f) => f.startsWith("atempo"));

        if (videoFilters.length > 0) {
          ffmpegArgs.push("-vf", videoFilters.join(","));
        }
        if (audioFilters.length > 0) {
          ffmpegArgs.push("-af", audioFilters.join(","));
        }
      }

      // Audio handling
      if (input.edits.audio && !input.edits.audio.keep_original) {
        ffmpegArgs.push("-an"); // strip audio
      }

      // Output settings
      ffmpegArgs.push(
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
      );

      // Max duration
      if (input.edits.output_format?.max_duration_seconds) {
        ffmpegArgs.push("-t", input.edits.output_format.max_duration_seconds.toString());
      }

      ffmpegArgs.push(outputPath);
      await runFFmpeg(ffmpegArgs);
    }

    // Read output
    const outputBuffer = await readFile(outputPath);

    // Get duration from ffprobe
    const duration = await getVideoDuration(outputPath);

    logInfo("video-editor.complete", {
      size_mb: (outputBuffer.length / 1024 / 1024).toFixed(2),
      duration_seconds: duration,
    });

    return {
      buffer: outputBuffer,
      mime_type: "video/mp4",
      duration_seconds: duration,
    };
  } finally {
    // Cleanup temp files
    for (const f of cleanupFiles) {
      await unlink(f).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Multi-clip combine
// ---------------------------------------------------------------------------

async function combineClips(
  input: VideoEditInput,
  inputFiles: string[],
  outputPath: string,
  tmpDir: string,
  cleanupFiles: string[]
): Promise<void> {
  const transition = input.edits.transition ?? "cut";

  if (transition === "cut") {
    // Simple concat via concat demuxer
    const concatList = inputFiles.map((f) => `file '${f}'`).join("\n");
    const concatPath = join(tmpDir, "concat.txt");
    await writeFile(concatPath, concatList);
    cleanupFiles.push(concatPath);

    const args = [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatPath,
    ];

    // Aspect ratio
    if (input.edits.output_format?.aspect_ratio) {
      const arFilter = ASPECT_RATIO_FILTERS[input.edits.output_format.aspect_ratio];
      if (arFilter) args.push("-vf", arFilter);
    }

    args.push(
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath
    );

    await runFFmpeg(args);
  } else if (transition === "crossfade") {
    // Crossfade between clips using xfade filter
    // For now, support 2-clip crossfade (can extend later)
    if (inputFiles.length < 2) {
      throw new Error("Crossfade requires at least 2 clips");
    }

    const fadeDuration = 0.5; // 0.5s crossfade
    const args = [
      "-y",
      ...inputFiles.flatMap((f) => ["-i", f]),
      "-filter_complex",
      `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=auto[v];[0:a][1:a]acrossfade=d=${fadeDuration}[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ];

    await runFFmpeg(args);
  } else if (transition === "fade_black") {
    // Fade to black between clips
    const fadeDuration = 0.3;
    const args = [
      "-y",
      ...inputFiles.flatMap((f) => ["-i", f]),
      "-filter_complex",
      `[0:v]fade=t=out:st=auto:d=${fadeDuration}[v0];[1:v]fade=t=in:st=0:d=${fadeDuration}[v1];[v0][v1]concat=n=2:v=1:a=0[v];[0:a][1:a]concat=n=2:v=0:a=1[a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ];

    await runFFmpeg(args);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getVideoDuration(filePath: string): Promise<number> {
  try {
    // Use ffprobe to get duration
    const ffprobePath = ffmpegPath.replace("ffmpeg", "ffprobe");
    const proc = spawn(ffprobePath, [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      filePath,
    ]);

    let output = "";
    proc.stdout?.on("data", (d) => { output += d.toString(); });

    await new Promise<void>((resolve) => proc.on("close", () => resolve()));
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}
