import { NextResponse } from "next/server";
import { open } from "@/lib/api/route";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const POST = open(async () => {
  const res = NextResponse.json({ success: true, data: null });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
