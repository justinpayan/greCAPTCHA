import { describe, expect, it } from "vitest";

import { splitCode } from "@/lib/code-text";

describe("code in generated text", () => {
  it("takes fenced blocks and inline code out of the prose", () => {
    expect(splitCode("What does `f(2)` print?\n```python\nprint($x)\n```\nExplain.")).toEqual([
      { type: "text", value: "What does " },
      { type: "inline-code", value: "f(2)" },
      { type: "text", value: " print?\n" },
      { type: "code-block", value: "print($x)", language: "python" },
      { type: "text", value: "\nExplain." },
    ]);
  });

  it("leaves unclosed fences and backticks as prose", () => {
    expect(splitCode("Use ``` carefully and a lone ` too.")).toEqual([
      { type: "text", value: "Use ``` carefully and a lone ` too." },
    ]);
  });

  it("returns plain prose unchanged", () => {
    expect(splitCode("The estimate $\\hat\\beta$ is biased.")).toEqual([
      { type: "text", value: "The estimate $\\hat\\beta$ is biased." },
    ]);
  });
});
