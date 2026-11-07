import { describe, expect, it } from "vitest";

import { signInSchema, signUpSchema } from "@/lib/validation/auth";
import { amountSchema, periodMonthSchema } from "@/lib/validation/common";
import { createContractorSchema, payoutMethodSchema } from "@/lib/validation/contractors";
import { inviteMemberSchema } from "@/lib/validation/organizations";
import { approvePayRunSchema, rejectPayRunSchema, upsertPayRunItemSchema } from "@/lib/validation/pay-runs";

const ORG_ID = "6f1c2b4e-8a7d-4c3b-9e2f-1a2b3c4d5e6f";
const HASH = "a".repeat(64);

describe("amounts", () => {
  it.each(["1", "150000", "150000.5", "150000.50", "1000000000"])("accepts %s", (value) => {
    expect(amountSchema.parse(value)).toBe(value);
  });

  it.each(["0", "0.00", "-1", "1.005", "1e5", "12,000", "abc", "1000000000.01", ""])(
    "rejects %s",
    (value) => {
      expect(amountSchema.safeParse(value).success).toBe(false);
    },
  );

  it("keeps amounts as strings so they never become floats", () => {
    const item = upsertPayRunItemSchema.parse({
      payRunId: ORG_ID,
      contractorId: ORG_ID,
      amount: "0.10",
      memo: "",
    });
    expect(item.amount).toBe("0.10");
    expect(item.memo).toBeNull();
  });
});

describe("periods and identifiers", () => {
  it("normalizes a month to its first day and rejects anything else", () => {
    expect(periodMonthSchema.parse("2026-11")).toBe("2026-11-01");
    for (const value of ["2026-13", "2026-11-15", "Nov 2026"]) {
      expect(periodMonthSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects non-UUID identifiers", () => {
    expect(
      createContractorSchema.safeParse({
        organizationId: "1 OR 1=1",
        fullName: "Ada Obi",
        countryCode: "NG",
      }).success,
    ).toBe(false);
  });
});

describe("contractors", () => {
  it("normalizes email and country code", () => {
    const parsed = createContractorSchema.parse({
      organizationId: ORG_ID,
      fullName: "  Ada Obi ",
      email: " ADA@Example.COM ",
      countryCode: "ng",
    });
    expect(parsed).toEqual({
      organizationId: ORG_ID,
      fullName: "Ada Obi",
      email: "ada@example.com",
      countryCode: "NG",
    });
  });

  it("treats a blank email as none", () => {
    const parsed = createContractorSchema.parse({
      organizationId: ORG_ID,
      fullName: "Ada Obi",
      email: "",
      countryCode: "NG",
    });
    expect(parsed.email).toBeNull();
  });
});

describe("payout methods", () => {
  const ngn = {
    rail: "bank_transfer",
    currency: "NGN",
    details: { bank_id: "044", account_number: "0123456789", account_name: "Ada Obi" },
  };

  it("accepts the documented NGN bank fields", () => {
    expect(payoutMethodSchema.safeParse(ngn).success).toBe(true);
  });

  it("rejects unexpected fields", () => {
    expect(
      payoutMethodSchema.safeParse({ ...ngn, details: { ...ngn.details, swift_code: "X" } }).success,
    ).toBe(false);
  });

  it("rejects a rail and currency that do not go together", () => {
    expect(payoutMethodSchema.safeParse({ ...ngn, currency: "USD" }).success).toBe(false);
    expect(
      payoutMethodSchema.safeParse({
        rail: "mobile_money",
        currency: "USD",
        details: { phone_number: "+15550000000", mobile_money_operator_id: "1", account_name: "A B" },
      }).success,
    ).toBe(false);
  });

  it("requires international format for mobile money numbers", () => {
    const mobile = {
      rail: "mobile_money",
      currency: "KES",
      details: { phone_number: "0712345678", mobile_money_operator_id: "1", account_name: "Wanjiru K" },
    };
    expect(payoutMethodSchema.safeParse(mobile).success).toBe(false);
    expect(
      payoutMethodSchema.safeParse({ ...mobile, details: { ...mobile.details, phone_number: "+254712345678" } })
        .success,
    ).toBe(true);
  });

  it("normalizes GBP sort codes and EUR IBANs", () => {
    const gbp = payoutMethodSchema.parse({
      rail: "bank_transfer",
      currency: "GBP",
      details: {
        account_number: "12345678",
        sort_code: "12-34-56",
        account_name: "Sam Lee",
        country: "GB",
        street: "1 High St",
        city: "London",
        zip_code: "N1 1AA",
      },
    });
    expect(gbp.details).toMatchObject({ sort_code: "123456" });

    const eur = payoutMethodSchema.parse({
      rail: "bank_transfer",
      currency: "EUR",
      details: {
        iban: "de89 3704 0044 0532 0130 00",
        bic_code: "cobadeffxxx",
        account_name: "Max Muster",
        country: "DE",
        street: "Hauptstr. 1",
        city: "Berlin",
        zip_code: "10115",
      },
    });
    expect(eur.details).toMatchObject({ iban: "DE89370400440532013000", bic_code: "COBADEFFXXX" });
  });
});

describe("approvals", () => {
  it("requires the reviewed submission and snapshot hash", () => {
    expect(approvePayRunSchema.safeParse({ payRunId: ORG_ID, submissionId: ORG_ID, snapshotHash: HASH }).success).toBe(
      true,
    );
    expect(approvePayRunSchema.safeParse({ payRunId: ORG_ID, submissionId: ORG_ID }).success).toBe(false);
    expect(
      approvePayRunSchema.safeParse({ payRunId: ORG_ID, submissionId: ORG_ID, snapshotHash: "XYZ" }).success,
    ).toBe(false);
  });

  it("requires a comment to reject", () => {
    const base = { payRunId: ORG_ID, submissionId: ORG_ID, snapshotHash: HASH };
    expect(rejectPayRunSchema.safeParse({ ...base, comment: "   " }).success).toBe(false);
    expect(rejectPayRunSchema.safeParse({ ...base, comment: "Wrong amount" }).success).toBe(true);
  });
});

describe("membership and auth", () => {
  it("only accepts known roles", () => {
    const base = { organizationId: ORG_ID, email: "a@example.com" };
    expect(inviteMemberSchema.safeParse({ ...base, role: "approver" }).success).toBe(true);
    expect(inviteMemberSchema.safeParse({ ...base, role: "owner" }).success).toBe(false);
  });

  it("requires sign-up passwords of at least 12 characters", () => {
    const base = { fullName: "Ada Obi", email: "ada@example.com" };
    expect(signUpSchema.safeParse({ ...base, password: "short-pass1" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, password: "a-much-longer-passphrase" }).success).toBe(true);
  });

  it("caps sign-in input sizes", () => {
    expect(signInSchema.safeParse({ email: "ada@example.com", password: "x".repeat(129) }).success).toBe(false);
  });
});
