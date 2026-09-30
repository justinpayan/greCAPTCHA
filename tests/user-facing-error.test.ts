import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { OpenRouterError } from "@/lib/openrouter-errors";
import {
  CONNECTION_MESSAGE,
  publicErrorMessage,
  userFacingMessage,
} from "@/lib/user-facing-error";

describe("user-facing error messages", () => {
  it("keeps the app's own messages", () => {
    expect(userFacingMessage(new Error("Choose a PDF manuscript."), "x")).toBe(
      "Choose a PDF manuscript.",
    );
    expect(userFacingMessage(new OpenRouterError("OpenRouter rejected that API key."), "x")).toBe(
      "OpenRouter rejected that API key.",
    );
  });

  it("replaces browser and runtime errors with the plain fallback", () => {
    const clipboard = new DOMException(
      "Failed to execute 'writeText' on 'Clipboard': Write permission denied.",
      "NotAllowedError",
    );
    expect(userFacingMessage(clipboard, "Unable to copy the link.")).toBe(
      "Unable to copy the link.",
    );
    expect(userFacingMessage(new SyntaxError("Unexpected token '<'"), "Unable to load.")).toBe(
      "Unable to load.",
    );
    expect(userFacingMessage(new TypeError("x is not a function"), "Something failed.")).toBe(
      "Something failed.",
    );
    expect(userFacingMessage("a string", "Fallback.")).toBe("Fallback.");
  });

  it("explains a request that never reached the server", () => {
    expect(userFacingMessage(new TypeError("Failed to fetch"), "x")).toBe(CONNECTION_MESSAGE);
    expect(userFacingMessage(new TypeError("Load failed"), "x")).toBe(CONNECTION_MESSAGE);
  });
});

describe("public API error messages", () => {
  it("never returns a validation dump or a database error", () => {
    let validation: unknown;
    try {
      z.object({ count: z.number() }).parse({ count: "two" });
    } catch (error) {
      validation = error;
    }
    expect(publicErrorMessage(validation, "Check the form and try again.")).toBe(
      "Check the form and try again.",
    );

    let database: unknown;
    try {
      new Database(":memory:").prepare("select * from missing_table").all();
    } catch (error) {
      database = error;
    }
    expect(publicErrorMessage(database, "Unable to load the set.")).toBe("Unable to load the set.");

    let body: unknown;
    try {
      JSON.parse("<html>");
    } catch (error) {
      body = error;
    }
    expect(publicErrorMessage(body, "Unable to read the request.")).toBe(
      "Unable to read the request.",
    );
  });

  it("passes the app's own refusals through", () => {
    expect(publicErrorMessage(new Error("A question set may contain at most 50 questions."), "x")).toBe(
      "A question set may contain at most 50 questions.",
    );
  });
});
