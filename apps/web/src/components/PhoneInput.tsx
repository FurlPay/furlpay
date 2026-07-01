"use client";

import { useState } from "react";
import { COUNTRIES, DEFAULT_COUNTRY, toE164, type Country } from "@/lib/countries";

// Country-selector + national-number input. Emits the assembled E.164 string
// (or null while it isn't yet a valid number) so the parent can enable "Send
// code". Deliverability across countries is handled by the OTP provider.
export default function PhoneInput({
  onChange,
  disabled,
}: {
  onChange: (e164: string | null) => void;
  disabled?: boolean;
}) {
  const [iso, setIso] = useState(DEFAULT_COUNTRY.iso);
  const [national, setNational] = useState("");

  function emit(nextIso: string, nextNational: string) {
    const country = COUNTRIES.find((c) => c.iso === nextIso) ?? DEFAULT_COUNTRY;
    onChange(toE164(country.dial, nextNational));
  }

  const country: Country = COUNTRIES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY;

  return (
    <div className="flex gap-2">
      <div className="relative">
        <select
          aria-label="Country"
          value={iso}
          disabled={disabled}
          onChange={(e) => {
            setIso(e.target.value);
            emit(e.target.value, national);
          }}
          className="h-full appearance-none rounded-2xl bg-surface py-3 pl-3 pr-7 text-sm outline-none disabled:opacity-50"
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.flag} {c.iso} +{c.dial}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-textMuted">▾</span>
      </div>
      <div className="flex flex-1 items-center rounded-2xl bg-surface px-3">
        <span className="mr-1 text-textSecondary">+{country.dial}</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="Phone number"
          value={national}
          disabled={disabled}
          onChange={(e) => {
            setNational(e.target.value);
            emit(iso, e.target.value);
          }}
          className="w-full bg-transparent py-3 outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}
