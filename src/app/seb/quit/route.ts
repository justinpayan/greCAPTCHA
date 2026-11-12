export function GET() {
  return new Response("Your assessment session has ended.", { headers: { "Cache-Control": "no-store" } });
}
