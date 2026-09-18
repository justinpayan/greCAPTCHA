import "server-only";

const jobKeys = new Map<string, string>();

export class JobKeyUnavailableError extends Error {
  constructor() {
    super("This job was interrupted and its temporary API key is no longer available. Paste a key and run it again.");
    this.name = "JobKeyUnavailableError";
  }
}

export function registerJobKey(jobId: string, apiKey: string) {
  jobKeys.set(jobId, apiKey);
}

export function requireJobKey(jobId: string) {
  const apiKey = jobKeys.get(jobId);
  if (!apiKey) throw new JobKeyUnavailableError();
  return apiKey;
}

export function deleteJobKey(jobId: string) {
  jobKeys.delete(jobId);
}

/** Test hook that also models a process restart without persisting any secret. */
export function clearJobKeys() {
  jobKeys.clear();
}
