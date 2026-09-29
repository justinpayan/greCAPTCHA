import { describe, expect, it } from "vitest";

import { createDefaultStudyTemplate } from "@/lib/default-study-template";

describe("default study template", () => {
  it("starts new Basic and Advanced configurations with a 30-minute limit", () => {
    expect(createDefaultStudyTemplate("test/model").overallTimeLimitSeconds).toBe(30 * 60);
  });
});
