import { buildAnswerCsv } from "@/lib/export";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Every recorded answer across every attempt, as CSV.
 *
 * Deliberately under `/api/export/` rather than `/api/attempts/export`: the participant
 * allowlist in middleware matches `/api/attempts/<id>` for GET, so an `export` segment
 * there would be read as an attempt ID and served without a session.
 */
export async function GET() {
  try {
    const csv = await buildAnswerCsv();
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="research-captcha-answers-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to build the export.";
    return Response.json({ error: message }, { status: 400 });
  }
}
