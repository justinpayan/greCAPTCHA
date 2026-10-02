import "server-only";

import dns from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";

import { MAX_PDF_BYTES, MAX_PDF_LABEL } from "@/lib/uploads";

/**
 * Fetching a manuscript from a link the researcher pasted, in place of an upload.
 *
 * The fetch runs on the server because most hosts (arXiv, publishers, institutional
 * repositories) send no CORS headers, so the browser could not read the file itself. That makes
 * this a server-side request to an arbitrary URL, and the guards below exist so it cannot be
 * pointed at anything but the public internet:
 *
 * - only `https:`, and no credentials in the URL;
 * - every address the host resolves to must be public — checked inside the socket's own DNS
 *   lookup, so the address that is vetted is the address that is connected to, and a host that
 *   re-resolves to an internal address between a check and the connection gains nothing;
 * - redirects are followed by hand, a few at most, and each hop is vetted the same way;
 * - the body is capped at the upload ceiling while it streams, and the whole fetch has a deadline.
 */

/** A refusal whose message is meant for the researcher. */
export class PdfLinkError extends Error {}

/** The linked file is bigger than an upload would be allowed to be. */
export class PdfLinkTooLargeError extends PdfLinkError {}

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Addresses a link may not reach: loopback, private networks, link-local (which includes cloud
 * metadata endpoints such as 169.254.169.254), carrier-grade NAT, benchmarking, multicast, and
 * reserved ranges, for both families.
 */
const blockedAddresses = (() => {
  const list = new net.BlockList();
  for (const [prefix, bits] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const) {
    list.addSubnet(prefix, bits, "ipv4");
  }
  for (const [prefix, bits] of [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["100::", 64],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ] as const) {
    list.addSubnet(prefix, bits, "ipv6");
  }
  return list;
})();

/** Whether a link may connect to this IP address. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family !== 6) return false;
  // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) reaches the IPv4 host it embeds.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  return !blockedAddresses.check(address, "ipv6");
}

/** Validates the shape of a pasted link. Cheap: nothing is fetched. */
export function parsePdfLink(raw: string, base?: URL, allowTestHttp = false): URL {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    throw new PdfLinkError("Enter a full link to the PDF, starting with https://.");
  }
  if (url.protocol !== "https:" && !(allowTestHttp && url.protocol === "http:")) {
    throw new PdfLinkError("Only encrypted https:// PDF links are supported.");
  }
  if (url.username || url.password) {
    throw new PdfLinkError("Links containing a username or password are not supported.");
  }
  return url;
}

const blockedHostMessage =
  "That link points to a private or local address. Link to a PDF on the public internet.";

type AddressPolicy = (address: string) => boolean;

/**
 * A DNS lookup for the socket that refuses to hand back any address the policy rejects.
 *
 * Every resolved address is checked, not only the first: the socket may try them in turn, and a
 * host that lists one public and one internal address would otherwise reach the internal one.
 */
function guardedLookup(allow: AddressPolicy): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 4);
      const list = addresses as dns.LookupAddress[];
      if (list.length === 0 || list.some((entry) => !allow(entry.address))) {
        return callback(new PdfLinkError(blockedHostMessage), "", 4);
      }
      if (options.all) return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

function requestOnce(
  url: URL,
  allow: AddressPolicy,
  signal: AbortSignal,
  allowTestHttp = false,
): Promise<IncomingMessage> {
  // A literal IP address is connected to without a lookup, so it is checked here instead.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (
    (net.isIP(literal) && !allow(literal)) ||
    (url.hostname.toLowerCase() === "localhost" && !allow("127.0.0.1"))
  ) {
    return Promise.reject(new PdfLinkError(blockedHostMessage));
  }
  if (url.protocol !== "https:" && !(allowTestHttp && url.protocol === "http:")) {
    return Promise.reject(new PdfLinkError("The PDF link must use HTTPS."));
  }
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        headers: {
          Accept: "application/pdf, */*;q=0.5",
          "User-Agent": "greCAPTCHA-demo/1.0 (manuscript fetch; +https://grecaptcha.com)",
        },
        lookup: guardedLookup(allow),
        signal,
      },
      resolve,
    );
    request.on("error", reject);
  });
}

/** The file name the download should carry: the server's, else the link's last path segment. */
function fileNameFor(url: URL, disposition: string | undefined): string {
  const declared =
    disposition &&
    (/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] ??
      /filename="?([^";]+)"?/i.exec(disposition)?.[1]);
  let name = "";
  try {
    name = decodeURIComponent(declared || url.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    name = "";
  }
  // Keep only characters that are safe in a displayed name; the stored copy is renamed anyway.
  name = name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "manuscript";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

const linkTooLargeMessage =
  `The linked PDF is larger than ${MAX_PDF_LABEL}, the most a manuscript may be. ` +
  "Upload a compressed copy instead.";

async function readCapped(response: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    total += (chunk as Buffer).length;
    if (total > MAX_PDF_BYTES) {
      response.destroy();
      throw new PdfLinkTooLargeError(linkTooLargeMessage);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads the PDF behind a link and returns it as a `File`, exactly as an upload would arrive.
 *
 * `isAllowedAddress` exists for tests, which serve fixtures from localhost; production callers
 * leave it unset so only public addresses are reachable.
 */
export async function fetchPdfLink(
  link: URL,
  options: { isAllowedAddress?: AddressPolicy; timeoutMs?: number } = {},
): Promise<File> {
  const allow = options.isAllowedAddress ?? isPublicAddress;
  const allowTestHttp = Boolean(options.isAllowedAddress);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let url = link;
    for (let hop = 0; ; hop += 1) {
      const response = await requestOnce(url, allow, controller.signal, allowTestHttp);
      const status = response.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status) && response.headers.location) {
        response.resume();
        if (hop >= MAX_REDIRECTS) throw new PdfLinkError("The link redirected too many times.");
        url = parsePdfLink(response.headers.location, url, allowTestHttp);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        throw new PdfLinkError(
          `The link could not be downloaded (the server answered HTTP ${status}). ` +
            "Check that it opens the PDF without signing in.",
        );
      }
      const declared = Number(response.headers["content-length"]);
      if (Number.isFinite(declared) && declared > MAX_PDF_BYTES) {
        response.destroy();
        throw new PdfLinkTooLargeError(linkTooLargeMessage);
      }
      const bytes = await readCapped(response);
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new PdfLinkError(
          "The link did not return a PDF. Link directly to the PDF file rather than to a web " +
            "page about it.",
        );
      }
      const name = fileNameFor(url, response.headers["content-disposition"]);
      return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
    }
  } catch (error) {
    if (error instanceof PdfLinkError) throw error;
    if (controller.signal.aborted) {
      throw new PdfLinkError("The link took too long to respond. Try again, or upload the PDF.");
    }
    // DNS failures, refused connections, TLS errors: the researcher can only check the link.
    throw new PdfLinkError(
      "The PDF could not be fetched from that link. Check the address, or upload the PDF instead.",
    );
  } finally {
    clearTimeout(timer);
  }
}
