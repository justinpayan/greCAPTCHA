export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
export const USERNAME_RULE =
  "Username must be 3–32 characters using letters, numbers, ., _, or -.";

export function normalizeUsername(username: string) {
  return username.normalize("NFKC").trim().toLowerCase();
}

export function validateUsername(username: string) {
  const trimmed = username.trim();
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new Error(USERNAME_RULE);
  }
  return trimmed;
}
