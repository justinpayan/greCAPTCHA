import { describe, expect, it } from "vitest";

import {
  decodeJobError,
  encodeJobError,
  errorFromPayload,
  errorResponseBody,
  OpenRouterError,
} from "@/lib/openrouter-errors";

describe("OpenRouter error tagging", () => {
  it("tags only OpenRouter failures in API responses", () => {
    expect(errorResponseBody(new OpenRouterError("OpenRouter rejected that API key."), "x")).toEqual({
      error: "OpenRouter rejected that API key.",
      errorSource: "openrouter",
    });
    expect(errorResponseBody(new Error("Choose a PDF manuscript."), "x")).toEqual({
      error: "Choose a PDF manuscript.",
    });
    expect(errorResponseBody("not an error", "Fallback.")).toEqual({ error: "Fallback." });
  });

  it("keeps the tag on a stored job failure and removes it before display", () => {
    const stored = encodeJobError(new OpenRouterError("Insufficient credits"), "Insufficient credits");
    expect(stored).not.toBe("Insufficient credits");
    expect(decodeJobError(stored)).toEqual({
      error: "Insufficient credits",
      errorSource: "openrouter",
    });
    const plain = encodeJobError(new Error("Malformed JSON"), "Malformed JSON");
    expect(decodeJobError(plain)).toEqual({ error: "Malformed JSON" });
    expect(decodeJobError(null)).toEqual({ error: null });
  });

  it("rebuilds the right error class in the browser", () => {
    expect(errorFromPayload({ error: "No credit", errorSource: "openrouter" }, "x")).toBeInstanceOf(
      OpenRouterError,
    );
    const other = errorFromPayload({ error: "Bad form" }, "x");
    expect(other).not.toBeInstanceOf(OpenRouterError);
    expect(other.message).toBe("Bad form");
    expect(errorFromPayload(undefined, "Fallback.").message).toBe("Fallback.");
  });
});
