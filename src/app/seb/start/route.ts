import { NextResponse } from "next/server";
import { redeemSebLaunch, SEB_COOKIE, sebOrigin, sebVerificationError } from "@/lib/seb";
import { enforceRateLimit } from "@/lib/security";

const responseHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

// Only pass static, trusted markup here. Never include launch tokens or request headers.
function page(title: string, content: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · greCAPTCHA</title>
    <style>*{box-sizing:border-box}body{margin:0;background:#f5f7f6;color:#182820;font:17px/1.6 system-ui,sans-serif}
    main{max-width:680px;margin:8vh auto;padding:clamp(24px,5vw,48px);background:white;border:1px solid #dce4df;border-radius:18px}
    h1{font-size:clamp(26px,5vw,36px);line-height:1.2;margin:0 0 24px}p,li{overflow-wrap:anywhere}li+li{margin-top:12px}
    label,input,button{display:block}input{width:100%;padding:12px;font:inherit;border:1px solid #738579;border-radius:8px;margin:8px 0 20px}
    button{background:#245b42;color:white;border:0;border-radius:8px;padding:12px 24px;font:inherit;cursor:pointer}
    :focus-visible{outline:3px solid #287a59;outline-offset:3px}.brand{color:#466453;font-weight:700;margin:0 0 24px}
    @media(max-width:720px){main{margin:24px 16px}}</style></head><body><main><p class="brand">greCAPTCHA</p>
    <h1>${title}</h1>${content}</main></body></html>`, {
    status, headers: { ...responseHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function verificationFailure(request: Request) {
  const error = sebVerificationError(request);
  if (!error) return null;
  const explanation = {
    "missing-proof": "This request did not include SEB’s Browser Exam Key verification header. If you are already in SEB, the exam configuration may not have verification enabled.",
    "invalid-proof": "SEB’s verification header was received, but its format was invalid.",
    "configuration": "The assessment server does not have a valid SEB origin and approved Browser Exam Key configured.",
    "key-mismatch": "SEB’s verification header was received, but it did not match the server’s approved Browser Exam Keys. This can happen after the settings file or SEB version changes, or when the server’s public origin differs from the address SEB opens.",
  }[error];
  return page("SEB verification could not be completed", `<p>${explanation}</p>
    <p>Return to your regular browser and launch using the conference’s current settings file. If this continues, give the organizer the diagnostic code below.</p>
    <p><strong>Diagnostic code:</strong> ${error}</p>
    <details><summary>Organizer setup checklist</summary><ol>
    <li>Open the settings file in SEB Configuration Tool. On the Exam tab, enable <strong>Use Browser Exam Key and Config Key</strong>.</li>
    <li>Save the final settings file, then copy its <strong>Browser Exam Key</strong> (not Config Key) into <code>SEB_BROWSER_EXAM_KEYS</code> on the server.</li>
    <li>Check that <code>SEB_PUBLIC_ORIGIN</code> matches the HTTPS origin SEB opens, including the port. Restart the server after changing environment variables.</li>
    <li>Fully close SEB, generate a new launch link in the regular browser, and try again.</li>
    </ol></details>`, 403);
}

async function redeem(request: Request, token: string) {
  await enforceRateLimit(request, "seb-launch", "pairing", 30, 600);
  const launch = /^[A-Za-z0-9_-]{32}$/.test(token) ? redeemSebLaunch(token) : undefined;
  if (!launch) return page("Launch link expired or already used", "<p>Return to greCAPTCHA in your regular browser and select <strong>Generate new launch link</strong>, then launch SEB again.</p>", 400);
  const response = NextResponse.redirect(new URL("/attempt/" + launch.attemptId, sebOrigin()), {
    status: 303, headers: responseHeaders,
  });
  response.cookies.set(SEB_COOKIE, launch.session, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 43_200,
  });
  return response;
}

export async function GET(request: Request) {
  const failure = verificationFailure(request);
  if (failure) return failure;
  const token = new URL(request.url).searchParams.get("launch");
  if (token) return redeem(request, token);
  return page("Connect your assessment", '<p>SEB opened without an automatic sign-in link. Enter the one-time pairing code from the launch page in your regular browser.</p><form method="post"><label for="code">One-time pairing code</label><input id="code" name="code" required autocomplete="off" autocapitalize="none" spellcheck="false" minlength="32" maxlength="32"><button type="submit">Connect assessment</button></form><p>The code works once and expires after 10 minutes. If needed, return to the launch page and generate a new link and code.</p>');
}

export async function POST(request: Request) {
  const failure = verificationFailure(request);
  if (failure) return failure;
  if (request.headers.get("origin") !== sebOrigin()) return page("Connection could not be completed", "<p>The form was submitted from an unexpected origin. Relaunch from greCAPTCHA and try again.</p>", 403);
  const form = await request.formData();
  return redeem(request, String(form.get("code") ?? "").trim());
}
