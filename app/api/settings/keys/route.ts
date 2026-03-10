import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/security/encryption";

const schema = z.object({
  provider: z.enum(["claude", "chatgpt", "gemini"]),
  apiKey: z.string().min(8).max(400),
});

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.from("user_api_keys").upsert(
    {
      user_id: user.id,
      provider: parsed.data.provider,
      encrypted_key: encryptSecret(parsed.data.apiKey),
    },
    { onConflict: "user_id,provider" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { user, response } = await requireUser();
  if (response || !user) return response;

  const provider = request.nextUrl.searchParams.get("provider");
  if (!provider || !["claude", "chatgpt", "gemini"].includes(provider)) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_api_keys").delete().eq("user_id", user.id).eq("provider", provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
