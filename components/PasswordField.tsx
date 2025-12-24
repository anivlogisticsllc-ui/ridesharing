// components/PasswordField.tsx
"use client";

import { useState } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  showStrength?: boolean;
};

function getPasswordStrength(pwd: string) {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 2) return "weak";
  if (score === 3) return "medium";
  return "strong";
}

export function PasswordField({ label, showStrength, ...inputProps }: Props) {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");

  const strength = showStrength ? getPasswordStrength(value) : null;

  return (
    <div className="space-y-1">
      <label className="block text-xs text-slate-600 mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          {...inputProps}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            inputProps.onChange?.(e);
          }}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-2 flex items-center text-xs text-slate-500"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {showStrength && value && (
        <p
          className={
            "text-[11px]" +
            (strength === "weak"
              ? " text-rose-600"
              : strength === "medium"
              ? " text-amber-600"
              : " text-emerald-600")
          }
        >
          Password strength: {strength}
        </p>
      )}
    </div>
  );
}
