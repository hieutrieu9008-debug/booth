import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/sms/provisioning", () => ({
  getProvisioner: vi.fn(),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getProvisioner } from "@/lib/sms/provisioning";
import { provisionNumber, PROVIDER_UNCONFIGURED_MESSAGE } from "./provision-number";

const mockedCreateAdmin = vi.mocked(createSupabaseAdminClient);
const mockedGetProvisioner = vi.mocked(getProvisioner);

type RestaurantRow = { id: string; sms_from: string | null } | null;

/** Minimal stand-in for the supabase-js query builder chains this module uses. */
function adminStub(restaurant: RestaurantRow, updateErrorMessage?: string) {
  const restaurantsTable = {
    select: () => restaurantsTable,
    eq: () => restaurantsTable,
    maybeSingle: async () => ({ data: restaurant, error: null }),
    update: () => ({ eq: async () => ({ error: updateErrorMessage ? { message: updateErrorMessage } : null }) }),
  };
  const auditTable = { insert: vi.fn(async () => ({ error: null })) };
  return { from: (table: string) => (table === "restaurants" ? restaurantsTable : auditTable) };
}

describe("provisionNumber error mapping", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    mockedCreateAdmin.mockReset();
    mockedGetProvisioner.mockReset();
  });

  it("reports unconfigured when Twilio credentials are missing (no DB call)", async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_UK_BUNDLE_SID = "BUxxxx";

    const result = await provisionNumber("r1");

    expect(result).toEqual({ ok: false, reason: PROVIDER_UNCONFIGURED_MESSAGE });
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });

  it("reports unconfigured when the RC bundle SID env is missing (no DB call)", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    delete process.env.TWILIO_UK_BUNDLE_SID;

    const result = await provisionNumber("r1");

    expect(result).toEqual({ ok: false, reason: PROVIDER_UNCONFIGURED_MESSAGE });
    expect(mockedCreateAdmin).not.toHaveBeenCalled();
  });

  it("no-ops with the existing number when sms_from is already set", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_UK_BUNDLE_SID = "BUxxxx";
    mockedCreateAdmin.mockReturnValue(adminStub({ id: "r1", sms_from: "+447700900123" }) as never);

    const result = await provisionNumber("r1");

    expect(result).toEqual({ ok: true, phoneNumber: "+447700900123" });
    expect(mockedGetProvisioner).not.toHaveBeenCalled();
  });

  it("surfaces the provider's API error message on purchase failure", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_UK_BUNDLE_SID = "BUxxxx";
    mockedCreateAdmin.mockReturnValue(adminStub({ id: "r1", sms_from: null }) as never);
    mockedGetProvisioner.mockReturnValue({
      searchUkMobile: vi.fn(async () => [{ phoneNumber: "+447700900123", monthlyCostUsd: null }]),
      purchase: vi.fn(async () => {
        throw new Error("Unable to create record: Number Reservation expired");
      }),
    });

    const result = await provisionNumber("r1");

    expect(result).toEqual({ ok: false, reason: "Unable to create record: Number Reservation expired" });
  });

  it("purchases, writes sms_from, and returns the new number on success", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACxxxx";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_UK_BUNDLE_SID = "BUxxxx";
    mockedCreateAdmin.mockReturnValue(adminStub({ id: "r1", sms_from: null }) as never);
    mockedGetProvisioner.mockReturnValue({
      searchUkMobile: vi.fn(async () => [{ phoneNumber: "+447700900123", monthlyCostUsd: null }]),
      purchase: vi.fn(async () => ({ providerNumberSid: "PNxxxx" })),
    });

    const result = await provisionNumber("r1");

    expect(result).toEqual({ ok: true, phoneNumber: "+447700900123" });
  });
});
