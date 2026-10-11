"use client";

import type { ReactNode } from "react";
import Select, { type SelectClasses } from "@/components/form/Select";

// The partnership dialog's selects: the shared themed Select, dressed in the
// dialog's own tokens (partners.css). Behaviour — portal into the open
// <dialog>, placement, keyboard, touch — lives in components/form/Select.tsx.

const FP_CLASSES: SelectClasses = {
  trigger: "fp-input fp-combobox",
  value: "fp-combobox-value",
  placeholder: "fp-placeholder",
  chevron: "fp-combobox-chevron",
  icon: "fp-combobox-icon",
  list: "fp-listbox",
  option: "fp-option",
};

type Option = { value: string; label: string };
type Props = {
  id: string;
  labelId: string;
  value: string;
  options: readonly Option[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  icon?: ReactNode;
};

export default function PartnershipSelect(props: Props) {
  return <Select {...props} classes={FP_CLASSES} />;
}
