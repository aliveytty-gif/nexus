"use client";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function SubmitButton({
  children,
  pendingText = "Сохраняем…",
  className = "button button-primary",
  disabled = false,
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
    >
      {pending ? pendingText : children}
    </button>
  );
}
