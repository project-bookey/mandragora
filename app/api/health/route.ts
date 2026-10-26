import { NextResponse } from "next/server";
import { listMessages } from "@/lib/messages";
import { getServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getServerClient();
    if (db) {
      const { error } = await db.from("mandrakes").select("id").limit(1);
      if (error) throw error;
    } else {
      listMessages();
    }
    return NextResponse.json({ status: "ok", service: "mandragora", storage: db ? "supabase" : "sqlite" });
  } catch {
    return NextResponse.json({ status: "error", service: "mandragora" }, { status: 503 });
  }
}
