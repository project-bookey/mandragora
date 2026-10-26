import { NextResponse } from "next/server";
import { badWord } from "@/lib/badwords";
import { getServerClient } from "@/lib/supabase";
import { listMessages, saveMessage } from "@/lib/messages";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getServerClient();
    if (db) {
      const { data, error } = await db.from("mandrakes").select("id, text").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(listMessages(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load mandrakes", error);
    return NextResponse.json({ message: "불러오다 문제가 생겼어요." }, { status: 503 });
  }
}

const MAX = 100;
const COOLDOWN_MS = 30_000;
// Best-effort per-IP cooldown. On serverless hosts each instance keeps its own map,
// so treat this as a speed bump, not a guarantee.
const lastByIp = new Map<string, number>();

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ code: "invalid", message: "잘못된 요청이에요." }, { status: 400 }); }
  const raw = typeof (body as { text?: unknown })?.text === "string" ? (body as { text: string }).text : "";
  const text = raw.replace(/\s+/g, " ").trim();
  const len = [...text].length;
  if (!len) return NextResponse.json({ code: "empty", message: "한 글자 이상 입력해 주세요." }, { status: 400 });
  if (len > MAX) return NextResponse.json({ code: "long", message: `${MAX}자까지 입력할 수 있어요.` }, { status: 400 });
  if (badWord(text)) return NextResponse.json({ code: "bad", message: "욕설이나 누군가를 깎아내리는 표현은 빼고 입력해 주세요." }, { status: 400 });

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  const now = Date.now(), last = lastByIp.get(ip) || 0;
  if (now - last < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    return NextResponse.json({ code: "rate", message: `${wait}초 뒤에 다시 입력할 수 있어요.` }, { status: 429 });
  }

  const db = getServerClient();
  if (!db) {
    try {
      const result = saveMessage(text, ip);
      if ("wait" in result) return NextResponse.json({ code: "rate", message: `${result.wait}초 뒤에 다시 입력할 수 있어요.` }, { status: 429 });
      return NextResponse.json(result.row, { status: 201 });
    } catch (error) {
      console.error("Failed to save mandrake", error);
      return NextResponse.json({ code: "db", message: "저장하다 문제가 생겼어요. 잠시 뒤 다시 입력해 주세요." }, { status: 503 });
    }
  }
  const { data, error } = await db.from("mandrakes").insert({ text }).select("id, text").single();
  if (error) return NextResponse.json({ code: "db", message: "저장하다 문제가 생겼어요. 잠시 뒤 다시 입력해 주세요." }, { status: 500 });

  lastByIp.set(ip, now);
  if (lastByIp.size > 5000) lastByIp.clear();
  return NextResponse.json(data, { status: 201 });
}
