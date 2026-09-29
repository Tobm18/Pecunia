"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Spinner } from "./spinner";

/** Bouton d'envoi d'un <form action={…}> : spinner et désactivation pendant l'envoi. */
export function SubmitButton({
  children,
  pendingChildren,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pendingChildren?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (
        <>
          <Spinner size={16} />
          {pendingChildren !== undefined ? pendingChildren : children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
