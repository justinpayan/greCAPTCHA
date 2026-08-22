/**
 * Opt-in request logging, for when something between the tunnel and the model is misbehaving.
 *
 * `next start` prints nothing per request, so a production run is silent by default. Set
 * `LOG_REQUESTS=1` to get one line per incoming request and one per call the server makes out to a
 * model. Off by default and deliberately so: a session log should not be a second copy of the
 * study's data.
 *
 * **Never log a request or response body.** Incoming bodies carry participant answers and uploaded
 * manuscripts; outgoing ones carry the PDF and the answer keys. Only metadata belongs here — method,
 * path, outcome, status, duration, size.
 *
 * Edge-safe: no imports, no Node APIs, so middleware can use it too.
 */
export const requestLoggingOn = process.env.LOG_REQUESTS === "1";

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

/** One line for a request arriving at the server, with what the gate decided about it. */
export function logIncoming(method: string, pathname: string, outcome: string) {
  if (!requestLoggingOn) return;
  console.log(`${stamp()}  in   ${method.padEnd(6)} ${pathname}  → ${outcome}`);
}

/** One line for a call the server makes out, timed, with no body either way. */
export async function logOutgoing<T>(
  label: string,
  detail: string,
  run: () => Promise<T & { status?: number }>,
): Promise<T> {
  if (!requestLoggingOn) return run();
  const startedAt = Date.now();
  try {
    const result = await run();
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const status = typeof result.status === "number" ? result.status : "—";
    console.log(
      `${stamp()}  out  ${label}  ${detail}  → ${status} in ${seconds}s`,
    );
    return result;
  } catch (error) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const reason = error instanceof Error ? error.message : "failed";
    console.log(
      `${stamp()}  out  ${label}  ${detail}  → threw after ${seconds}s: ${reason}`,
    );
    throw error;
  }
}
