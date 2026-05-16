/**
 * Tunisian payment gateway abstraction. The four providers we support
 * (Konnect, Paymee, Flouci, D17) each have slightly different API
 * shapes, but the surface we need from them on Batta is the same:
 *
 *   1. Initiate a payment for an amount + return a hosted-page URL.
 *   2. Verify a webhook callback so we can mark the payment captured.
 *
 * This file implements (1) as stubs that build the documented request
 * payloads but DO NOT call the network when keys are missing — instead
 * they return a faux hosted URL pointing at our own /payment/mock page
 * so the dev UI keeps working without test credentials.
 *
 * Replace the `if (!apiKey)` blocks with real `fetch(...)` calls to
 * each provider once production keys are in place.
 *
 * Provider docs (verified 2026-05):
 *   • Konnect:  https://docs.konnect.network
 *   • Paymee:   https://docs.paymee.tn
 *   • Flouci:   https://flouci-pay.gitbook.io/api
 *   • D17:      Bank-issued integration spec (no public docs)
 */

import type { PaymentProvider } from "./types";

export type InitiateInput = {
  amountTND: number; // dinars (not millimes)
  description: string;
  // Idempotency key the platform passes through to dedupe webhook
  // retries against our `payments.id`.
  ourPaymentId: string;
  // Where the gateway should redirect after success / failure.
  successUrl: string;
  failUrl: string;
  customer: { email: string; phone?: string | null; name?: string | null };
};

export type InitiateResult = {
  hostedUrl: string;
  providerRef: string;
};

export async function initiatePayment(
  provider: PaymentProvider,
  input: InitiateInput,
): Promise<InitiateResult> {
  switch (provider) {
    case "konnect":
      return initiateKonnect(input);
    case "paymee":
      return initiatePaymee(input);
    case "flouci":
      return initiateFlouci(input);
    case "d17":
      return initiateD17(input);
    case "manual":
      // Manual / wire-transfer flow — in dev the simulation captures it
      // the same as any other provider so the seller/buyer can test the
      // end-to-end flow. In production this branch should be replaced
      // with a real "submitted, awaiting admin review" page where an
      // admin manually marks the payment captured after seeing the bank
      // statement.
      return mock("manual", input);
  }
}

// ─── Konnect (Tunisian central-bank-licensed wallet) ────────────────────────

async function initiateKonnect(input: InitiateInput): Promise<InitiateResult> {
  const apiKey = process.env.KONNECT_API_KEY;
  if (!apiKey) return mock("konnect", input);

  // Konnect amounts are in millimes (1 TND = 1000 m).
  const body = {
    receiverWalletId: process.env.KONNECT_WALLET_ID,
    token: "TND",
    amount: Math.round(input.amountTND * 1000),
    description: input.description,
    acceptedPaymentMethods: ["wallet", "bank_card", "e-DINAR"],
    successUrl: input.successUrl,
    failUrl: input.failUrl,
    orderId: input.ourPaymentId,
    firstName: input.customer.name?.split(" ")[0] ?? "Bidder",
    lastName: input.customer.name?.split(" ").slice(1).join(" ") || "Batta",
    email: input.customer.email,
    phoneNumber: input.customer.phone ?? "",
  };

  const r = await fetch("https://api.konnect.network/api/v2/payments/init-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Konnect init failed: ${r.status}`);
  const data = (await r.json()) as { payUrl: string; paymentRef: string };
  return { hostedUrl: data.payUrl, providerRef: data.paymentRef };
}

// ─── Paymee (e-commerce focused, popular with agencies) ─────────────────────

async function initiatePaymee(input: InitiateInput): Promise<InitiateResult> {
  const apiKey = process.env.PAYMEE_API_KEY;
  if (!apiKey) return mock("paymee", input);

  const body = {
    amount: input.amountTND, // Paymee accepts decimal TND directly.
    note: input.description,
    first_name: input.customer.name?.split(" ")[0] ?? "Bidder",
    last_name: input.customer.name?.split(" ").slice(1).join(" ") || "Batta",
    email: input.customer.email,
    phone: input.customer.phone ?? "",
    return_url: input.successUrl,
    cancel_url: input.failUrl,
    webhook_url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/payments/paymee/webhook`,
    order_id: input.ourPaymentId,
  };
  const r = await fetch("https://app.paymee.tn/api/v2/payments/create", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Paymee init failed: ${r.status}`);
  const data = (await r.json()) as { data: { payment_url: string; token: string } };
  return { hostedUrl: data.data.payment_url, providerRef: data.data.token };
}

// ─── Flouci (consumer wallet) ──────────────────────────────────────────────

async function initiateFlouci(input: InitiateInput): Promise<InitiateResult> {
  const appToken = process.env.FLOUCI_APP_TOKEN;
  const appSecret = process.env.FLOUCI_APP_SECRET;
  if (!appToken || !appSecret) return mock("flouci", input);

  const body = {
    app_token: appToken,
    app_secret: appSecret,
    amount: String(Math.round(input.amountTND * 1000)), // millimes, as string
    accept_card: "true",
    session_timeout_secs: 1200,
    success_link: input.successUrl,
    fail_link: input.failUrl,
    developer_tracking_id: input.ourPaymentId,
  };
  const r = await fetch("https://developers.flouci.com/api/generate_payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Flouci init failed: ${r.status}`);
  const data = (await r.json()) as { result: { link: string; payment_id: string } };
  return { hostedUrl: data.result.link, providerRef: data.result.payment_id };
}

// ─── D17 (La Poste Tunisienne wallet) ───────────────────────────────────────

async function initiateD17(input: InitiateInput): Promise<InitiateResult> {
  const merchantId = process.env.D17_MERCHANT_ID;
  if (!merchantId) return mock("d17", input);

  // D17 is bank-issued — endpoint and signing is per integration kit.
  // Stubbed pending the Poste Tunisienne contract.
  return mock("d17", input);
}

function mock(provider: string, input: InitiateInput): InitiateResult {
  const url = new URL("/payment/mock", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  url.searchParams.set("provider", provider);
  url.searchParams.set("amount", String(input.amountTND));
  url.searchParams.set("id", input.ourPaymentId);
  url.searchParams.set("success", input.successUrl);
  return { hostedUrl: url.toString(), providerRef: `mock-${input.ourPaymentId}` };
}
