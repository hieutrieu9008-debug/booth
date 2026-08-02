"use client";

import { forwardRef } from "react";
import { formatUkMobile, formatUsMobile } from "./phone-format";

export type PhoneInputProps = {
  /** National-format value, e.g. "07700 900000" (leading 0 kept — the chip shows the country code separately). */
  value: string;
  onChange: (value: string) => void;
  /** Country code chip, e.g. "+44". Non-editable — display only. Defaults to "+44" (UK-first PRD). */
  prefix?: string;
  id?: string;
  name?: string;
  label: string;
  /** Labeled example number, greyed via placeholder — never a real number. */
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  error?: string;
  className?: string;
};

/**
 * Locale-aware strict phone mask (DESIGN.md / SPEC-WS2 §3): a non-editable
 * country-code chip beside a digits-only, fixed-length, grouped national
 * number field. UK (+44) and US/NANP (+1) grouping are implemented; any
 * other prefix falls back to a plain digit filter with no grouping.
 * Server-side normalizePhone stays the source of truth; this is display/UX only.
 */
export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(function PhoneInput(
  { value, onChange, prefix = "+44", id, name, label, placeholder, required, autoFocus, disabled, error, className = "" }: PhoneInputProps,
  ref
) {
  const inputId = id ?? name ?? "phone";
  const prefixDigits = prefix.replace(/\D/g, "");
  const isUk = prefixDigits === "44";
  const isUs = prefixDigits === "1";

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    onChange(isUk ? formatUkMobile(e.target.value) : isUs ? formatUsMobile(e.target.value) : e.target.value.replace(/\D/g, "").slice(0, 15));
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <span
          aria-hidden="true"
          className="flex min-h-11 shrink-0 items-center rounded-button border-2 border-line bg-peach px-3 font-display text-base font-bold text-ink"
        >
          {prefix}
        </span>
        <input
          ref={ref}
          id={inputId}
          name={name}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={value}
          onChange={handleChange}
          placeholder={placeholder ?? (isUk ? "07700 900000" : isUs ? "(334) 555-0182" : undefined)}
          required={required}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={isUk ? 12 : isUs ? 14 : 16}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="min-h-11 w-full rounded-button border-2 border-line bg-cream px-4 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark disabled:opacity-50"
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} className="text-sm font-semibold text-coral-dark" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
