"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const isField = (t: EventTarget | null): t is Field =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

/** Marks a message set here, so it is cleared on the next keystroke and recomputed. */
const OURS = "mazedValidity";

/**
 * The browser's own « Please fill out this field » came up in English on the
 * French and Arabic pages (2026-10-27 audit). One listener for every form:
 * when a field fails the browser's check, its message is said in the page's
 * language instead, from what failed — empty, too short, not an e-mail, out
 * of range. A message a page set itself (setCustomValidity) is left alone.
 */
export function LocalizedValidation() {
  const t = useTranslations("validation");

  useEffect(() => {
    const messageFor = (el: Field): string => {
      const v = el.validity;
      if (v.valueMissing) {
        if (el instanceof HTMLSelectElement) return t("select");
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return t("check");
        return t("required");
      }
      if (v.typeMismatch) return el.type === "email" ? t("email") : el.type === "url" ? t("url") : t("format");
      if (v.badInput) return t("number");
      if (v.tooShort && !(el instanceof HTMLSelectElement)) return t("tooShort", { min: el.minLength });
      if (v.tooLong && !(el instanceof HTMLSelectElement)) return t("tooLong", { max: el.maxLength });
      if (v.rangeUnderflow && el instanceof HTMLInputElement) return t("min", { min: el.min });
      if (v.rangeOverflow && el instanceof HTMLInputElement) return t("max", { max: el.max });
      if (v.stepMismatch) return t("step");
      if (v.patternMismatch) return el.title || t("format");
      return "";
    };

    const onInvalid = (e: Event) => {
      const el = e.target;
      if (!isField(el)) return;
      if (el.validity.customError) {
        if (el.dataset[OURS] !== "1") return;
        el.setCustomValidity("");
      }
      const msg = messageFor(el);
      if (!msg) return;
      el.dataset[OURS] = "1";
      el.setCustomValidity(msg);
    };
    const onEdit = (e: Event) => {
      const el = e.target;
      if (isField(el) && el.dataset[OURS] === "1") {
        el.setCustomValidity("");
        delete el.dataset[OURS];
      }
    };

    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, [t]);

  return null;
}
