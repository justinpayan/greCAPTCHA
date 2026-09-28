import { describe, expect, it } from "vitest";

import { registerAccount } from "@/lib/accounts";
import { getStartedHidden, setGetStartedHidden } from "@/lib/preferences";

describe("dashboard preferences", () => {
  it("remembers the Get started choice per account", async () => {
    const dana = await registerAccount({ username: "dana.pref", password: "long-password-dana" });
    const erin = await registerAccount({ username: "erin.pref", password: "long-password-erin" });

    // Shown by default.
    expect(await getStartedHidden(dana.id)).toBe(false);

    await setGetStartedHidden(dana.id, true);
    expect(await getStartedHidden(dana.id)).toBe(true);
    // One account's choice does not affect another's.
    expect(await getStartedHidden(erin.id)).toBe(false);

    await setGetStartedHidden(dana.id, false);
    expect(await getStartedHidden(dana.id)).toBe(false);
  });
});
