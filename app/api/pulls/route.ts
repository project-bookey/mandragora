import { NextResponse } from "next/server";
import { hasMessage, listPulls, savePull } from "@/lib/messages";
import { getServerClient } from "@/lib/supabase";
import { badWord } from "@/lib/badwords";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const channel = Number(params.get("channel"));
  const since = params.has("since") ? Number(params.get("since")) : null;
  if (!Number.isInteger(channel) || channel < 1 || channel > 4 || (since !== null && (!Number.isSafeInteger(since) || since < 0))) return NextResponse.json({}, { status: 400 });
  try {
    return NextResponse.json(listPulls(channel, since), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "실시간 연결이 잠시 끊겼어요." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({}, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({}, { status: 400 });
  const { client, channel, text, seed, x, y } = body;
  if (typeof client !== "string" || !/^[a-f0-9-]{36}$/.test(client) || !Number.isInteger(channel) || channel < 1 || channel > 4 || typeof text !== "string" || !text.trim() || [...text].length > 100 || badWord(text) || !Number.isInteger(seed) || seed < 0 || seed > 4294967295 || typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1 || typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1) return NextResponse.json({}, { status: 400 });
  try {
    const sb = getServerClient();
    if (sb) {
      const { data, error } = await sb.from("mandrakes").select("id").eq("text", text).limit(1);
      if (error) throw error;
      if (!data?.length) return NextResponse.json({}, { status: 400 });
    } else if (!hasMessage(text)) return NextResponse.json({}, { status: 400 });
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
    const saved = savePull({ client, channel, text, seed, x, y }, ip);
    return NextResponse.json({}, { status: saved ? 201 : 429 });
  } catch {
    return NextResponse.json({}, { status: 503 });
  }
}
