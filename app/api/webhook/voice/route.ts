import { NextRequest, NextResponse } from "next/server";
import { validateWebhookSecret } from "@/lib/webhook/auth";
import { embedAndStore } from "@/lib/embedding";
import { logError } from "@/lib/logger";

const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";

async function transcribeAudio(audioBlob: Blob, filename: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY for Whisper transcription");

  const form = new FormData();
  form.append("file", audioBlob, filename);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "text");

  const res = await fetch(WHISPER_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: { message?: string } }).error?.message ?? `Whisper call failed (${res.status})`);
  }

  // response_format=text returns plain text, not JSON.
  return res.text();
}

/**
 * POST /api/webhook/voice
 *
 * Expects multipart/form-data with:
 *   - audio: File (audio file — m4a, mp3, wav, webm, etc.)
 *   - userId: string
 *   - projectId?: string
 *   - tags?: string (comma-separated)
 *   - asIdea?: "true" (if set, also upserts to ideas table)
 */
export async function POST(request: NextRequest) {
  const authError = validateWebhookSecret(request.headers.get("x-webhook-secret"));
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");
    const userId = formData.get("userId") as string | null;
    const projectId = (formData.get("projectId") as string | null) || undefined;
    const tagsRaw = formData.get("tags") as string | null;
    const asIdea = formData.get("asIdea") === "true";

    if (!userId || !audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { error: "userId and audio file are required" },
        { status: 400 },
      );
    }

    const filename = audioFile instanceof File ? audioFile.name : "audio.m4a";

    // 1. Transcribe via Whisper
    const transcript = await transcribeAudio(audioFile, filename);

    if (!transcript.trim()) {
      return NextResponse.json({ error: "Transcription returned empty" }, { status: 422 });
    }

    // 2. Embed and store
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : ["voice"];

    const result = await embedAndStore(transcript, {
      userId,
      source: "manual",
      projectId,
      category: "general",
      importance: 5,
      tags,
      extra: asIdea
        ? { asIdea: true, sourceType: "voice_memo", title: transcript.slice(0, 80) }
        : undefined,
    });

    return NextResponse.json({
      success: true,
      transcript,
      memoryIds: result.memoryIds,
      sourceIds: result.sourceIds,
      chunkCount: result.chunkCount,
    });
  } catch (error) {
    logError("webhook.voice", error);
    return NextResponse.json({ error: "Failed to process voice webhook" }, { status: 500 });
  }
}
