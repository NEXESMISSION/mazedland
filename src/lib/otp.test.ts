import { describe, it, expect, beforeAll } from "vitest";
import { PHONE_PROOF_TTL_MS, hashCode, signPhoneProof, verifyPhoneProof } from "./otp";

beforeAll(() => {
  process.env.SMS_OTP_PEPPER = "test-pepper";
});

describe("hashCode", () => {
  it("is stable per (phone, code) and differs across both", () => {
    expect(hashCode("+21620000000", "123456")).toBe(hashCode("+21620000000", "123456"));
    expect(hashCode("+21620000000", "123456")).not.toBe(hashCode("+21620000001", "123456"));
    expect(hashCode("+21620000000", "123456")).not.toBe(hashCode("+21620000000", "123457"));
  });
});

describe("phone verification proof", () => {
  const phone = "+21620000000";
  const proof = () => signPhoneProof(phone, Date.now() + PHONE_PROOF_TTL_MS);

  it("accepts its own proof for the same number", () => {
    expect(verifyPhoneProof(proof(), phone)).toBe(true);
  });

  it("refuses another number — the takeover this closes", () => {
    expect(verifyPhoneProof(proof(), "+21620000001")).toBe(false);
  });

  it("refuses a missing, malformed or tampered proof", () => {
    expect(verifyPhoneProof(undefined, phone)).toBe(false);
    expect(verifyPhoneProof("", phone)).toBe(false);
    expect(verifyPhoneProof("not-a-proof", phone)).toBe(false);
    const p = proof();
    expect(verifyPhoneProof(p.slice(0, -2) + "xy", phone)).toBe(false);
    // Same shape, extended expiry, signature from the shorter payload.
    const [ph, exp, sig] = p.split(".");
    expect(verifyPhoneProof(`${ph}.${Number(exp) + 60_000}.${sig}`, phone)).toBe(false);
  });

  it("expires", () => {
    const past = signPhoneProof(phone, Date.now() - 1);
    expect(verifyPhoneProof(past, phone)).toBe(false);
    const future = signPhoneProof(phone, Date.now() + 1000);
    expect(verifyPhoneProof(future, phone, Date.now() + 2000)).toBe(false);
  });
});
