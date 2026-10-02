import { buildAnswerCsv } from "@/lib/export";
import { requireUser } from "@/lib/session";
import { publicErrorMessage } from "@/lib/user-facing-error";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Every recorded answer across every attempt, as CSV.
 *
 * Deliberately under `/api/export/` rather than `/api/attempts/export`: the participant
 * allowlist in middleware matches `/api/attempts/<id>` for GET, so an `export` segment
 * there would be read as an attempt ID and served without a session.
 */
/** How many question sets one export may name; a dashboard selection is far below it. */
const MAX_SELECTED_SETS = 1_000;

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    // `?sets=id1,id2` exports only those question sets (the dashboard's "Export selected").
    const raw = new URL(request.url).searchParams.get("sets");
    const selected =
      raw === null
        ? undefined
        : [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
    const malformed = selected?.some((id) => !/^[\w-]+$/.test(id));
    if (selected && (selected.length > MAX_SELECTED_SETS || malformed)) {
      throw new Error("The selection could not be exported. Choose the tests again.");
    }
    const csv = await buildAnswerCsv(user.id, selected);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="research-captcha-answers-${
          selected ? "selected-" : ""
        }${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = publicErrorMessage(error, "Unable to build the export.");
    return Response.json({ error: message }, { status: 400 });
  }
}
