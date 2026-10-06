"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { apiErrorMessage } from "./apiError";

/**
 * `const apiError = useApiError();` → `apiError(payload, fallback)` gives the
 * sentence to show for a failed API call, in the page's language. See
 * src/lib/apiError.ts.
 */
export function useApiError() {
  const t = useTranslations("apiErrors");
  return useCallback(
    (payload: unknown, fallback: string) => apiErrorMessage(payload, fallback, (code) => t(code)),
    [t],
  );
}
