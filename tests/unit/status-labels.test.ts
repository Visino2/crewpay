import { describe, expect, it } from "vitest";

import { PAY_RUN_STATUS, PAYMENT_STATUS } from "@/lib/format/status";

describe("status wording", () => {
  it("never describes a workflow state as paid or completed", () => {
    for (const config of Object.values(PAY_RUN_STATUS)) {
      expect(config.label.toLowerCase()).not.toMatch(/\b(paid|complete|completed|sent)\b/);
    }
  });

  it("states plainly that approval does not move money", () => {
    expect(PAY_RUN_STATUS.approved.description).toMatch(/no money has been sent/i);
  });

  it("has only the not-sent payment state until a provider is connected", () => {
    expect(Object.keys(PAYMENT_STATUS)).toEqual(["not_sent"]);
    expect(PAYMENT_STATUS.not_sent.label).toBe("Not sent");
  });
});
