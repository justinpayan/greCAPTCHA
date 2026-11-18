import "server-only";

import nodemailer from "nodemailer";

export function mailConfiguration() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM?.trim();
  const base = process.env.PUBLIC_BASE_URL?.trim();
  const port = Number(process.env.SMTP_PORT || "587");
  if (!host || !user || !pass || !from || !base || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Email delivery is temporarily unavailable. Please try again later.");
  }
  const url = new URL(base);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
    throw new Error("Email delivery is temporarily unavailable. Please try again later.");
  }
  return { host, port, user, pass, from, base: url.origin };
}

export async function sendAccountEmail(email: string, purpose: "verify" | "reset", token: string) {
  const config = mailConfiguration();
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.port === 465, requireTLS: true,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  const link = `${config.base}/account/${purpose === "verify" ? "verify-email" : "reset-password"}#${token}`;
  try {
    await transport.sendMail({
      from: config.from, to: email,
      subject: purpose === "verify" ? "Verify your greCAPTCHA email" : "Reset your greCAPTCHA password",
      text: `${purpose === "verify" ? "Verify your email address" : "Reset your password"} by opening this link:\n\n${link}\n\nThis link expires in ${purpose === "verify" ? "24 hours" : "30 minutes"}. If you did not request it, you can ignore this email.`,
    });
  } catch {
    console.error("[account-email] Delivery failed.");
    throw new Error("Email delivery is temporarily unavailable. Please try again later.");
  } finally {
    transport.close();
  }
}
