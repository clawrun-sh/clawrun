import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    agent: "zeroclaw",
    version: "0.1.0",
  });
}
