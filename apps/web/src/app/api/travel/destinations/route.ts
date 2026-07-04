import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { DESTINATION_CATEGORIES } from "@/lib/travel/data";

// GET /api/travel/destinations — destination categories for discovery.
export async function GET() {
  return NextResponse.json({ categories: DESTINATION_CATEGORIES });
}
