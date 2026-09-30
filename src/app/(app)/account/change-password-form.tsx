"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormFeedback, SubmitButton, useRecordedAction } from "@/components/forms";
import { Field, inputClass } from "@/components/ui";
import {
  PASSWORD_MIN_LENGTH,
  passwordChangeSchema,
  type PasswordChangeInput,
} from "@/modules/identity/domain";
import { changePasswordAction } from "./actions";

/**
 * Changes the owner's password.
 *
 * Three fields, and no stored hash ever reaches the browser: the current password
 * is sent once, compared on the server, then replaced by a bcrypt hash.
 *
 * `autoComplete` is spelled out so a password manager offers to update the saved
 * entry instead of silently keeping the old one — the most common way a password
 * change appears to fail.
 */
export function ChangePasswordForm() {
  const form = useForm<PasswordChangeInput>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const { result, submit } = useRecordedAction(form, changePasswordAction);
  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={submit} className="grid max-w-md gap-3" noValidate>
      <Field
        label="Mot de passe actuel"
        htmlFor="current-password"
        error={errors.currentPassword?.message}
      >
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          className={inputClass}
          {...form.register("currentPassword")}
        />
      </Field>

      <Field
        label="Nouveau mot de passe"
        htmlFor="new-password"
        hint={`Au moins ${PASSWORD_MIN_LENGTH} caractères.`}
        error={errors.newPassword?.message}
      >
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register("newPassword")}
        />
      </Field>

      <Field
        label="Confirmer le nouveau mot de passe"
        htmlFor="confirm-password"
        error={errors.confirmPassword?.message}
      >
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register("confirmPassword")}
        />
      </Field>

      <div>
        <SubmitButton label="Changer le mot de passe" pending={isSubmitting} />
      </div>

      <FormFeedback result={result} successMessage="Mot de passe modifié." />

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Un changement déconnecte toutes les sessions, y compris celle-ci : vous serez
        invité à vous reconnecter avec le nouveau mot de passe.
      </p>
    </form>
  );
}
