import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** @deprecated Use POST /api/admin/brbyte/check-conversion */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "deprecated",
      message:
        "A conversão no Controllr é feita pelo comercial no ERP. Use POST /api/admin/brbyte/check-conversion.",
    },
    { status: 410 }
  )
}
