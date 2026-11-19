import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cookies: {} as Record<string, string>, mail: [] as Array<{ to: string; text: string }>, mailFails: false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => state.cookies[key] ? { value: state.cookies[key] } : undefined }) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({
  sendMail: async (mail: { to: string; text: string }) => {
    if (state.mailFails) throw new Error("SMTP rejected credentials");
    state.mail.push(mail);
  }, close: () => {},
}) } }));

import { db, databaseFile } from "@/db";
import { accountTokens, attemptAnswers, attemptFeedback, attempts, backupCodes, conferenceSubmissions, fileDeletions, jobs, questionSets, sessions, studyTemplates, trustedDevices, users } from "@/db/schema";
import { accountForSession, authenticateAccount, changeAccountPassword, createAccountSession, registerAccount } from "@/lib/accounts";
import { base32Secret, matchingStep, openSecret, sealSecret, secretHash, totpCode } from "@/lib/account-crypto";
import { accountById, beginEnrollment, consumeFactor, finishEnrollment, issueToken, readToken, regenerateCodes,
  requestEmail, requestPasswordReset, resetPassword, revokeDevices, trustedBrowser, verifyEmail, verifyLoginChallenge } from "@/lib/account-security";
import { deleteAccount, hasRemainingTests, runFileCleanup } from "@/lib/account-deletion";
import { requireTestAdministrator, requireUser } from "@/lib/session";
import { POST as securityAction } from "@/app/api/account/security/route";
import { GET as createdTests } from "@/app/api/created-tests/route";
import { GET as templatesRoute } from "@/app/api/templates/route";
import { GET as exportsRoute } from "@/app/api/export/answers/route";
import { deleteAttempt, deleteQuestionSet, listCreatedTests } from "@/lib/catalog";
import { hydrateAssessmentResult, requireAttemptOwner } from "@/lib/attempts";
import { AdministratorContact } from "@/components/quiz/administrator-contact";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssessmentResult } from "@/lib/quiz";
import { deleteTemplate, saveTemplate } from "@/lib/templates";
import { manuscriptPath, templateMaterialPath } from "@/lib/manuscripts";
import { executeGeneration, type GenerationJobPayload } from "@/lib/generation";
import { setOpenRouterTransportForTests } from "@/lib/openrouter";
import { bundleFromZip, serializeBundle } from "@/lib/code-bundle";
import { writeEncryptedFile } from "@/lib/data-encryption";
import { strToU8, zipSync } from "fflate";
import { POST as signupRoute } from "@/app/api/signup/route";
import { POST as loginRoute } from "@/app/api/session/route";

const password = "correct horse battery staple";
const secret = "3132333435363738393031323334353637383930";
const currentCode = () => totpCode(secret, Math.floor(Date.now() / 30000));

beforeEach(() => {
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("SMTP_HOST", "smtp.example.org"); vi.stubEnv("SMTP_USER", "user");
  vi.stubEnv("SMTP_PASSWORD", "secret"); vi.stubEnv("SMTP_FROM", "grecaptcha@example.org");
  vi.stubEnv("PUBLIC_BASE_URL", "https://grecaptcha.example.org");
  state.cookies = {}; state.mail = []; state.mailFails = false;
});

async function account(verified = true, mfa = false) {
  const created = await registerAccount({ username: `u-${randomUUID().slice(0, 18)}`, password });
  db.update(users).set({ verifiedEmail: verified ? `${created.id}@example.org` : null, mfaSecret: mfa ? sealSecret(secret) : null }).where(eq(users.id, created.id)).run();
  return accountById(created.id);
}

function mailToken() { return state.mail.at(-1)!.text.match(/#([A-Za-z0-9_-]+)/)![1]; }
function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/account/security", { method: "POST", headers: { "content-type": "application/json", host: "localhost", "x-forwarded-for": randomUUID() }, body: JSON.stringify(body) });
}

async function seedSet(ownerId: string) {
  const id = randomUUID();
  db.insert(questionSets).values({ id, ownerUserId: ownerId, schemaVersion: 1, paperName: "private.pdf", contributions: "", modelId: "model", pdfEngine: "native", configJson: "[]", questionsJson: "[]", createdAt: new Date().toISOString() }).run();
  fs.mkdirSync(path.dirname(manuscriptPath(id)), { recursive: true });
  fs.writeFileSync(manuscriptPath(id), "private source");
  return id;
}

function seedAttempt(setId: string, takerId: string) {
  const id = randomUUID();
  db.insert(attempts).values({ id, questionSetId: setId, takerUserId: takerId, questionOrderJson: "[]", createdAt: new Date().toISOString() }).run();
  return id;
}

describe("account security", () => {
  it("creates an unverified signup session, then requires email and offers optional MFA", async () => {
    const username = `signup-${randomUUID().slice(0, 12)}`;
    const response = await signupRoute(request({ username, password, passwordConfirmation: password, email: `${username}@example.org` }));
    expect(response.status).toBe(201);
    expect((await response.json()).next).toContain("/account/email");
    const cookie = response.headers.get("set-cookie")!.match(/rc_session=([^;]+)/)![1];
    state.cookies.rc_session = cookie;
    await expect(requireUser()).rejects.toThrow(/Verify your email/);
    const verification = await securityAction(request({ action: "verify-email", token: mailToken() }));
    expect(verification.status).toBe(200);
    expect(await accountForSession(cookie)).toBeNull();
    state.cookies = {};
    const login = await loginRoute(request({ username, password }));
    expect((await login.json()).next).toBe("/account/onboarding");
  });

  it("requires an MFA challenge at sign-in and accepts a remembered browser after password verification", async () => {
    const user = await account(true, true);
    const login = await loginRoute(request({ username: user.username, password }));
    expect((await login.json()).next).toBe("/account/challenge");
    const challenge = login.headers.get("set-cookie")!.match(/rc_auth_challenge=([^;]+)/)![1];
    state.cookies.rc_auth_challenge = challenge;
    const verified = await securityAction(request({ action: "challenge", code: currentCode(), remember: true }));
    expect(verified.status).toBe(200);
    const trusted = verified.headers.get("set-cookie")!.match(/rc_trusted_device=([^;]+)/)![1];
    state.cookies.rc_trusted_device = trusted;
    const remembered = await loginRoute(request({ username: user.username, password }));
    expect((await remembered.json()).next).toBeUndefined();
    expect(remembered.headers.get("set-cookie")).toContain("rc_session=");
    const badPassword = await loginRoute(request({ username: user.username, password: "wrong password" }));
    expect(badPassword.status).toBe(401);
  });

  it("keeps forgot-password responses uniform and enforces per-destination email limits", async () => {
    const user = await account(); const unverified = await account(false);
    const responses = [];
    for (const email of [user.verifiedEmail, `${unverified.id}@example.org`, "unknown@example.org"]) {
      const response = await securityAction(request({ action: "forgot-password", email }));
      responses.push({ status: response.status, body: await response.json() });
    }
    expect(responses[0]).toEqual(responses[1]); expect(responses[1]).toEqual(responses[2]);
    expect(state.mail).toHaveLength(1);
    for (let i = 0; i < 5; i++) await securityAction(request({ action: "forgot-password", email: user.verifiedEmail }));
    expect(state.mail).toHaveLength(3);
    state.mailFails = true;
    const outage = await securityAction(request({ action: "forgot-password", email: user.verifiedEmail }));
    expect(await outage.json()).toEqual(responses[0].body);
  });

  it("looks up recovery by normalized verified email and ignores pending replacements", async () => {
    const user = await account();
    const pending = `pending-${randomUUID()}@example.org`;
    issueToken(user, "verify", 86400, pending);
    const response = await securityAction(request({ action: "forgot-password", email: `  ${user.verifiedEmail!.toUpperCase()}  ` }));
    expect(response.status).toBe(200);
    expect(state.mail).toHaveLength(1);
    expect(state.mail[0].to).toBe(user.verifiedEmail);
    await requestPasswordReset(pending);
    expect(state.mail).toHaveLength(1);
    const usernameOnly = await securityAction(request({ action: "forgot-password", username: user.username }));
    expect(usernameOnly.status).toBe(400);
    expect(state.mail).toHaveLength(1);
  });

  it("requires a fresh settings challenge before setup and binds the unlock to one session", async () => {
    const user = await account(true, true);
    state.cookies.rc_session = await createAccountSession(user.id);
    const setup = { action: "begin-enrollment" };
    expect((await securityAction(request(setup))).status).toBe(403);
    expect((await securityAction(request({ action: "unlock-settings", password, code: "invalid" }))).status).toBe(400);
    const unlocked = await securityAction(request({ action: "unlock-settings", password, code: currentCode() }));
    expect(unlocked.status).toBe(200);
    const { grant } = await unlocked.json();
    expect((await securityAction(request({ ...setup, grant }))).status).toBe(200);
    const original = state.cookies.rc_session;
    state.cookies.rc_session = await createAccountSession(user.id);
    expect((await securityAction(request({ ...setup, grant }))).status).toBe(403);
    state.cookies.rc_session = original;
    db.update(accountTokens).set({ expiresAt: new Date(0).toISOString() }).where(eq(accountTokens.tokenHash, secretHash(grant))).run();
    expect((await securityAction(request({ ...setup, grant }))).status).toBe(403);
  });

  it("matches RFC 6238 test vectors and rejects stale or malformed codes", () => {
    expect(totpCode(secret, 1)).toBe("287082");
    expect(totpCode(secret, 37037036)).toBe("081804");
    expect(base32Secret(secret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(matchingStep(secret, "287082", -1, 59000)).toBe(1);
    expect(matchingStep(secret, "287082", 1, 59000)).toBeNull();
    expect(matchingStep(secret, "abcdef")).toBeNull();
    expect(matchingStep(secret, totpCode(secret, 3), -1, 59000)).toBeNull();
  });

  it("encrypts authenticator secrets and authenticates the encrypted envelope", () => {
    const encrypted = sealSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(openSecret(encrypted)).toBe(secret);
    const bytes = Buffer.from(encrypted, "base64"); bytes[30] ^= 1;
    expect(() => openSecret(bytes.toString("base64"))).toThrow();
  });

  it("requires verified email and MFA for test administration, while permitting participant accounts", async () => {
    const user = await account(false);
    state.cookies.rc_session = await createAccountSession(user.id);
    await expect(requireUser()).rejects.toThrow(/Verify your email/);
    db.update(users).set({ verifiedEmail: `${user.id}@example.org` }).where(eq(users.id, user.id)).run();
    expect((await requireUser()).id).toBe(user.id);
    await expect(requireTestAdministrator()).rejects.toThrow(/multifactor/);
    for (const route of [createdTests, templatesRoute]) expect((await route()).status).toBeGreaterThanOrEqual(400);
    expect((await exportsRoute(new Request("http://localhost/api/export/answers"))).status).toBeGreaterThanOrEqual(400);
    db.update(users).set({ mfaSecret: sealSecret(secret) }).where(eq(users.id, user.id)).run();
    state.cookies.rc_session = await createAccountSession(user.id, { mfaVerified: true });
    expect((await requireTestAdministrator()).id).toBe(user.id);
  });

  it("verifies email with a single-use token and invalidates sessions and reset links", async () => {
    const user = await account(false);
    const session = await createAccountSession(user.id);
    const reset = issueToken(user, "reset", 1800);
    await requestEmail(user, "NEW@Example.org", password, "");
    const token = mailToken();
    expect(accountById(user.id).verifiedEmail).toBeNull();
    expect(db.select().from(accountTokens).where(eq(accountTokens.tokenHash, token)).get()).toBeUndefined();
    verifyEmail(token);
    expect(accountById(user.id).verifiedEmail).toBe("new@example.org");
    expect(await accountForSession(session)).toBeNull();
    expect(() => readToken(reset, "reset")).toThrow();
    expect(() => verifyEmail(token)).toThrow();
  });

  it("keeps the previous recovery address until replacement verification and rejects duplicate addresses", async () => {
    const user = await account(); const other = await account();
    await expect(requestEmail(user, other.verifiedEmail!, password, "")).rejects.toThrow(/already in use/);
    await requestEmail(user, "replacement@example.org", password, "");
    expect(accountById(user.id).verifiedEmail).toBe(user.verifiedEmail);
    verifyEmail(mailToken());
    expect(accountById(user.id).verifiedEmail).toBe("replacement@example.org");
  });

  it("keeps verification retryable after SMTP failure and rejects wrong-purpose or expired tokens", async () => {
    const user = await account(false); state.mailFails = true;
    await expect(requestEmail(user, "retry@example.org", password, "")).rejects.toThrow(/temporarily unavailable/);
    expect(accountById(user.id).verifiedEmail).toBeNull();
    state.mailFails = false;
    await requestEmail(user, "retry@example.org", password, "");
    const token = mailToken();
    expect(() => readToken(token, "reset")).toThrow();
    db.update(accountTokens).set({ expiresAt: "2000-01-01" }).where(eq(accountTokens.tokenHash, secretHash(token))).run();
    expect(() => verifyEmail(token)).toThrow();
  });

  it("confirms authenticator enrollment, issues hashed backup codes, and requires acknowledgement", async () => {
    const user = await account();
    const enrollment = await beginEnrollment(user, password, "");
    expect(enrollment.qrCode).toMatch(/^data:image\/png/);
    expect(accountById(user.id).mfaSecret).toBeNull();
    const encrypted = readToken(enrollment.enrollmentToken, "enroll").payload!;
    const code = totpCode(openSecret(encrypted), Math.floor(Date.now() / 30000));
    const result = finishEnrollment(user, enrollment.enrollmentToken, code);
    expect(result.codes).toHaveLength(10);
    expect(db.select().from(backupCodes).where(eq(backupCodes.userId, user.id)).all()).toHaveLength(10);
    expect(JSON.stringify(db.select().from(backupCodes).all())).not.toContain(result.codes[0]);
    expect((await securityAction(request({ action: "acknowledge-codes", token: result.acknowledgementToken }))).status).toBe(400);
    const acknowledged = await securityAction(request({ action: "acknowledge-codes", token: result.acknowledgementToken, acknowledged: true }));
    expect(acknowledged.status).toBe(200);
    expect(acknowledged.headers.get("set-cookie")).toContain("rc_session=");
    expect((await securityAction(request({ action: "acknowledge-codes", token: result.acknowledgementToken, acknowledged: true }))).status).toBe(400);
  });

  it("rejects replayed authenticator codes, reused challenges, and a sixth challenge attempt", async () => {
    const user = await account(true, true);
    const token = issueToken(user, "login", 600);
    expect(verifyLoginChallenge(token, currentCode(), false, "browser").account.id).toBe(user.id);
    expect(() => verifyLoginChallenge(token, currentCode(), false, "browser")).toThrow();
    const second = issueToken(accountById(user.id), "login", 600);
    expect(() => verifyLoginChallenge(second, currentCode(), false, "browser")).toThrow(/invalid|already used/);
    for (let i = 0; i < 4; i++) expect(() => verifyLoginChallenge(second, "invalid", false, "browser")).toThrow();
    expect(() => verifyLoginChallenge(second, "invalid", false, "browser")).toThrow(/Too many/);
  });

  it("trusts only the correct account's browser and revokes linked sessions", async () => {
    const user = await account(true, true); const other = await account(true, true);
    const result = verifyLoginChallenge(issueToken(user, "login", 600), currentCode(), true, "Test browser");
    const browser = trustedBrowser(accountById(user.id), result.deviceToken!)!;
    expect(trustedBrowser(other, result.deviceToken!)).toBeUndefined();
    const session = await createAccountSession(user.id, { mfaVerified: true, trustedDeviceId: browser.id });
    expect((await accountForSession(session))?.mfaVerified).toBe(true);
    expect(new Date(browser.expiresAt).getTime() - new Date(browser.createdAt).getTime()).toBe(30 * 86400000);
    revokeDevices(user.id);
    expect(await accountForSession(session)).toBeNull();
    expect(trustedBrowser(accountById(user.id), result.deviceToken!)).toBeUndefined();
  });

  it("rejects expired device trust and never creates trust from a backup code", async () => {
    const user = await account(true, true);
    const token = issueToken(user, "login", 600);
    const trusted = verifyLoginChallenge(token, currentCode(), true, "browser");
    db.update(trustedDevices).set({ expiresAt: "2000-01-01" }).where(eq(trustedDevices.id, trusted.trustedDeviceId!)).run();
    expect(trustedBrowser(accountById(user.id), trusted.deviceToken!)).toBeUndefined();
    const backup = "ABCD1234";
    db.insert(backupCodes).values({ userId: user.id, codeHash: secretHash(backup) }).run();
    const result = verifyLoginChallenge(issueToken(accountById(user.id), "login", 600), backup, true, "browser");
    expect(result.deviceToken).toBeUndefined();
    expect(() => consumeFactor(accountById(user.id), backup)).toThrow();
  });

  it("resets an unenrolled account through email and revokes old sessions", async () => {
    const user = await account(); const session = await createAccountSession(user.id);
    await requestPasswordReset(user.verifiedEmail!);
    const token = mailToken();
    await resetPassword(token, "new password for recovery", "");
    expect(await accountForSession(session)).toBeNull();
    expect(await authenticateAccount(user.username, password)).toBeNull();
    expect((await authenticateAccount(user.username, "new password for recovery"))?.id).toBe(user.id);
    await expect(resetPassword(token, password, "")).rejects.toThrow();
  });

  it("requires a factor during enrolled-account recovery and consumes backup codes once", async () => {
    const user = await account(true, true);
    await requestPasswordReset(user.verifiedEmail!); const token = mailToken();
    await expect(resetPassword(token, "new password for recovery", "")).rejects.toThrow();
    db.insert(backupCodes).values({ userId: user.id, codeHash: secretHash("ABCDEF123456") }).run();
    const results = await Promise.allSettled([
      resetPassword(token, "new password for recovery", "ABCDEF123456"),
      resetPassword(token, "different recovery password", "ABCDEF123456"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(db.select().from(backupCodes).where(eq(backupCodes.userId, user.id)).all()).toHaveLength(0);
  });

  it("invalidates trusted browsers and challenges after password changes and code regeneration", async () => {
    const user = await account(true, true);
    const trusted = verifyLoginChallenge(issueToken(user, "login", 600), currentCode(), true, "browser");
    const challenge = issueToken(accountById(user.id), "login", 600);
    await changeAccountPassword(user.id, password, "a different long password");
    expect(trustedBrowser(accountById(user.id), trusted.deviceToken!)).toBeUndefined();
    expect(() => readToken(challenge, "login")).toThrow();
    db.insert(backupCodes).values({ userId: user.id, codeHash: secretHash("REGENERATE123") }).run();
    const result = await regenerateCodes(accountById(user.id), "a different long password", "REGENERATE123");
    expect(result.codes).toHaveLength(10);
    expect(() => consumeFactor(accountById(user.id), "REGENERATE123")).toThrow();
  });

  it("blocks account deletion until owned tests and invitation tests are explicitly deleted", async () => {
    const owner = await account(); const other = await account();
    const ownSet = await seedSet(owner.id);
    const submission = seedAttempt(ownSet, other.id);
    await expect(deleteAccount(owner, password, "", "DELETE")).rejects.toThrow(/Delete all of your tests/);
    expect(db.select().from(attempts).where(eq(attempts.id, submission)).get()).toBeDefined();
    await deleteQuestionSet(ownSet, owner.id);
    const template = await saveTemplate(owner.id, `template-${randomUUID()}`, { blocks: [], modelId: "", pdfEngine: "native", randomize: false, overallTimeLimitSeconds: null }, "creator", "taker");
    await expect(deleteAccount(owner, password, "", "DELETE")).rejects.toThrow(/Delete all of your tests/);
    await deleteTemplate(template.id, owner.id);
    await deleteAccount(owner, password, "", "DELETE");
    expect(db.select().from(users).where(eq(users.id, owner.id)).get()).toBeUndefined();
  });

  it("deletes reusable templates and their files automatically with the account", async () => {
    const owner = await account();
    const template = await saveTemplate(owner.id, `reusable-${randomUUID()}`, { blocks: [], modelId: "", pdfEngine: "native", randomize: false, overallTimeLimitSeconds: null }, "creator", "creator");
    const files = [templateMaterialPath(template.id, "pdf"), templateMaterialPath(template.id, "code")];
    for (const file of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "template material");
    }
    expect(hasRemainingTests(owner.id)).toBe(false);
    await deleteAccount(owner, password, "", "DELETE");
    expect(db.select().from(studyTemplates).where(eq(studyTemplates.id, template.id)).get()).toBeUndefined();
    expect(db.select().from(users).where(eq(users.id, owner.id)).get()).toBeUndefined();
    for (const file of files) expect(fs.existsSync(file)).toBe(false);
  });

  it("retains submissions, source material, answers, grades and feedback after deleting a participant account", async () => {
    const administrator = await account(); const taker = await account();
    const setId = await seedSet(administrator.id);
    const attemptId = seedAttempt(setId, taker.id);
    const template = await saveTemplate(administrator.id, `retained-${randomUUID()}`, { blocks: [], modelId: "", pdfEngine: "native", randomize: false, overallTimeLimitSeconds: null }, "creator", "taker");
    const submissionId = randomUUID();
    db.insert(conferenceSubmissions).values({ id: submissionId, templateId: template.id, administratorUserId: administrator.id,
      takerUserId: taker.id, questionSetId: setId, attemptId, paperName: "private.pdf", contributions: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run();
    db.insert(attemptAnswers).values({ id: randomUUID(), attemptId, questionId: "q", questionType: "free_response", startedAt: new Date().toISOString(), answerJson: '{"text":"Retain this answer"}', score: 80 }).run();
    db.insert(attemptFeedback).values({ attemptId, submitterUserId: taker.id, submittedAt: new Date().toISOString(), generalComment: "Retain feedback" }).run();
    db.update(attempts).set({ score: 80, gradingJson: '{"overallScore":80}', status: "graded" }).where(eq(attempts.id, attemptId)).run();
    const gradingJobId = randomUUID();
    db.insert(jobs).values({ id: gradingJobId, ownerUserId: administrator.id, attemptId, type: "grading", status: "completed", payloadJson: JSON.stringify({ attemptId }), resultJson: '{"private":"cached results"}', createdAt: new Date().toISOString() }).run();
    const session = await createAccountSession(taker.id);
    await expect(deleteAccount(taker, "wrong", "", "DELETE")).rejects.toThrow();
    await expect(deleteAccount(taker, password, "", "delete")).rejects.toThrow(/Type DELETE/);
    await deleteAccount(taker, password, "", "DELETE");
    expect(await accountForSession(session)).toBeNull();
    const retained = db.select().from(attempts).where(eq(attempts.id, attemptId)).get()!;
    expect(retained.takerUserId).toBeNull(); expect(retained.takerUsername).toBe(taker.username);
    expect(retained.score).toBe(80); expect(retained.gradingJson).toContain("80");
    expect(db.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, attemptId)).get()?.answerJson).toContain("Retain this answer");
    expect(db.select().from(attemptFeedback).where(eq(attemptFeedback.attemptId, attemptId)).get()?.generalComment).toBe("Retain feedback");
    expect(db.select().from(conferenceSubmissions).where(eq(conferenceSubmissions.id, submissionId)).get()?.takerUserId).toBeNull();
    expect(fs.existsSync(manuscriptPath(setId))).toBe(true);
    await requireAttemptOwner(attemptId, administrator.id);
    expect(db.select().from(attempts).where(eq(attempts.id, attemptId)).get()?.takerUserId).toBeNull();
    await deleteAttempt(attemptId, administrator.id);
    expect(db.select().from(attempts).where(eq(attempts.id, attemptId)).get()).toBeUndefined();
    expect(db.select().from(questionSets).where(eq(questionSets.id, setId)).get()).toBeDefined();
    expect(fs.existsSync(manuscriptPath(setId))).toBe(true);
    expect(db.select().from(jobs).where(eq(jobs.id, gradingJobId)).get()).toBeUndefined();
  });

  it("keeps a shared taker upload until its last attempt and retries interrupted file cleanup", async () => {
    const owner = await account();
    const taker = await account();
    const setId = await seedSet(owner.id);
    db.update(questionSets).set({ materialUploader: "taker", materialKind: "code" }).where(eq(questionSets.id, setId)).run();
    const file = manuscriptPath(setId, "code");
    fs.renameSync(manuscriptPath(setId), file);
    const first = seedAttempt(setId, taker.id);
    const second = seedAttempt(setId, owner.id);
    const dashboardSet = () => listCreatedTests(owner.id).then(rows => rows.find(row => row.id === setId));
    expect((await dashboardSet())?.attempts.map(row => row.deletesSet)).toEqual([false, false]);
    await deleteAttempt(first, owner.id);
    expect(fs.existsSync(file)).toBe(true);
    expect((await dashboardSet())?.attempts).toMatchObject([{ id: second, deletesSet: true }]);

    const remove = fs.rmSync;
    const busy = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (target === file) throw new Error("file temporarily busy");
      remove(target, options);
    });
    try {
      await deleteAttempt(second, owner.id);
    } finally {
      busy.mockRestore();
    }
    expect(await dashboardSet()).toBeUndefined();
    expect(db.select().from(fileDeletions).where(eq(fileDeletions.path, file)).get()).toBeDefined();
    runFileCleanup();
    expect(fs.existsSync(file)).toBe(false);
    expect(db.select().from(fileDeletions).where(eq(fileDeletions.path, file)).get()).toBeUndefined();
  });

  it("keeps pending submissions and uploads for the administrator after account deletion", async () => {
    const administrator = await account(); const taker = await account();
    const template = await saveTemplate(administrator.id, `pending-${randomUUID()}`, { blocks: [], modelId: "", pdfEngine: "native", randomize: false, overallTimeLimitSeconds: null }, "creator", "taker");
    const jobId = randomUUID(); const submissionId = randomUUID();
    const filePath = path.join(path.dirname(databaseFile), "job-uploads", `${jobId}.pdf`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, "submitted source");
    db.insert(jobs).values({ id: jobId, ownerUserId: taker.id, type: "generation", status: "queued", payloadJson: JSON.stringify({ filePath, conferenceSubmissionId: submissionId }), createdAt: new Date().toISOString() }).run();
    db.insert(conferenceSubmissions).values({ id: submissionId, templateId: template.id, administratorUserId: administrator.id, takerUserId: taker.id, generationJobId: jobId,
      paperName: "submitted.pdf", contributions: "Submitted scope", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run();
    await deleteAccount(taker, password, "", "DELETE");
    const retained = db.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
    expect(retained.ownerUserId).toBe(administrator.id); expect(retained.status).toBe("failed");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(db.select().from(conferenceSubmissions).where(eq(conferenceSubmissions.id, submissionId)).get()?.contributions).toBe("Submitted scope");
    await deleteTemplate(template.id, administrator.id);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(db.select().from(conferenceSubmissions).where(eq(conferenceSubmissions.id, submissionId)).get()).toBeUndefined();
  });

  it("includes the administrator's current verified contact in older results and renders submission deletion guidance", async () => {
    const administrator = await account(); const setId = await seedSet(administrator.id);
    const legacy = { questionSetId: setId, administratorEmail: "old@example.org" } as AssessmentResult;
    expect(hydrateAssessmentResult(legacy, {}).administratorEmail).toBe(administrator.verifiedEmail);
    db.update(users).set({ verifiedEmail: "updated-administrator@example.org" }).where(eq(users.id, administrator.id)).run();
    const result = hydrateAssessmentResult(legacy, {});
    const html = renderToStaticMarkup(createElement(AdministratorContact, { email: result.administratorEmail }));
    expect(html).toContain('mailto:updated-administrator@example.org');
    expect(html).toContain("delete your submission");
  });

  it("prevents a running generation from publishing after account deletion", async () => {
    const owner = await account();
    const jobId = randomUUID();
    const setId = randomUUID();
    const filePath = path.join(path.dirname(databaseFile), "job-uploads", `${jobId}.code.json`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeEncryptedFile(filePath, serializeBundle(bundleFromZip(zipSync({ "src/main.py": strToU8("def total(a, b):\n    return a + b\n") }), "source.zip")), "job-upload");
    const payload: GenerationJobPayload = { questionSetId: setId, filePath, fileName: "source.code.json", materialKind: "code",
      apiKeyPayer: "creator", materialUploader: "creator", setName: "Deleted account's test", contributions: "", modelId: "test/model", pdfEngine: "native", randomize: false, overallTimeLimitSeconds: null,
      blocks: [{ id: "fr", type: "free_response", count: 1, candidatePoolSize: 1, name: "", prompt: "Explain how this function works.", rubricPrompt: "", warmup: false }],
    };
    db.insert(jobs).values({ id: jobId, ownerUserId: owner.id, type: "generation", status: "running", payloadJson: JSON.stringify(payload), createdAt: new Date().toISOString() }).run();
    let release!: () => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    setOpenRouterTransportForTests(async (input) => {
      if (String(input).endsWith("/models")) return Response.json({ data: [{ id: "test/model", context_length: 200000, architecture: { input_modalities: ["text"] } }] });
      notifyStarted(); await blocked;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ questions: [{ prompt: "How does total combine its inputs?", description: "Addition", path: "src/main.py", startLine: 1, endLine: 2, rubric: { summary: "Explains addition", criteria: [{ criterion: "Addition", points: 100, guidance: "Adds inputs." }] } }] }) } }] });
    });
    const running = executeGeneration(owner.id, payload, "test-key", async () => {}, jobId);
    await started;
    await deleteAccount(owner, password, "", "DELETE");
    release();
    await expect(running).rejects.toThrow(/cancelled/);
    expect(db.select().from(questionSets).where(eq(questionSets.id, setId)).get()).toBeUndefined();
    expect(fs.existsSync(manuscriptPath(setId, "code"))).toBe(false);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("persists interrupted cleanup for a cancelled private upload without removing retained submissions", async () => {
    const owner = await account();
    const jobId = randomUUID();
    const file = path.join(path.dirname(databaseFile), "job-uploads", `${jobId}.pdf`);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "private draft");
    db.insert(jobs).values({ id: jobId, ownerUserId: owner.id, type: "generation", status: "queued", payloadJson: JSON.stringify({ filePath: file }), createdAt: new Date().toISOString() }).run();
    const remove = vi.spyOn(fs, "rmSync").mockImplementationOnce(() => { throw new Error("file temporarily busy"); });
    await deleteAccount(owner, password, "", "DELETE"); remove.mockRestore();
    expect(db.select().from(fileDeletions).where(eq(fileDeletions.path, file)).get()).toBeDefined();
    runFileCleanup();
    expect(fs.existsSync(file)).toBe(false);
    expect(db.select().from(fileDeletions).where(eq(fileDeletions.path, file)).get()).toBeUndefined();
  });
});
