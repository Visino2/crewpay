import { describe, expect, it } from "vitest";

import { AppError, fromDatabaseError, publicMessage } from "@/lib/errors";

describe("fromDatabaseError", () => {
  it("keeps stable codes raised by the database functions", () => {
    const error = fromDatabaseError({ message: "self_approval_forbidden", code: "42501" });
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("self_approval_forbidden");
  });

  it("passes through short snake_case reasons only", () => {
    expect(fromDatabaseError({ message: "invalid_state", details: "stale_payout_method" }).reason).toBe(
      "stale_payout_method",
    );
    expect(
      fromDatabaseError({ message: "invalid_state", details: "Key (email)=(ada@example.com) exists" }).reason,
    ).toBeUndefined();
  });

  it("maps Postgres error classes without exposing their text", () => {
    expect(fromDatabaseError({ code: "23505", message: 'duplicate key value violates "x"' }).code).toBe(
      "conflict",
    );
    expect(fromDatabaseError({ code: "42501", message: "permission denied for table x" }).code).toBe(
      "not_authorized",
    );
    const unknown = fromDatabaseError({ code: "XX000", message: "internal: relation secret_table" });
    expect(unknown.code).toBe("unexpected");
    expect(unknown.message).not.toContain("secret_table");
  });
});

describe("publicMessage", () => {
  it("prefers a specific reason message when one exists", () => {
    expect(publicMessage("invalid_state", "empty_pay_run")).toMatch(/at least one contractor/);
    expect(publicMessage("invalid_state", "unknown_reason")).toBe(publicMessage("invalid_state"));
  });
});
