import type { InputHTMLAttributes, ReactNode } from "react";

export type FieldProps = {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">;

/** Labeled input wrapper: label, input, error slot, hint slot. */
export function Field({ label, id, error, hint, className = "", ...inputProps }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="min-h-11 rounded-button border-2 border-line bg-cream px-4 text-base text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
        {...inputProps}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm font-semibold text-coral-dark" role="alert">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export type CheckboxProps = {
  label: ReactNode;
  id: string;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "type">;

/** Checkbox styled to match Field — used later for the consent checkbox. */
export function Checkbox({ label, id, className = "", ...inputProps }: CheckboxProps) {
  return (
    <label htmlFor={id} className={`flex cursor-pointer items-start gap-3 ${className}`}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-2 border-line bg-cream accent-coral focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral-dark"
        {...inputProps}
      />
      <span className="text-sm text-ink">{label}</span>
    </label>
  );
}
