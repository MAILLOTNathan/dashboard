"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Notice, inputClass, submitClass, tdClass, thClass } from "@/components/ui";
import type { CategoryKind } from "@/modules/budget/domain";
import { deleteCategoryAction, mergeCategoriesAction, updateCategoryAction } from "./actions";

/**
 * Category management: rename, retype (only while unused), merge and delete.
 *
 * Everything destructive shows its counts before the click: a deletion detaches the
 * category from its transactions (their amounts stay) and deletes its budgets, and a
 * merge can drop duplicate budgets — the confirmation says so, and the merge reports
 * exactly what it moved. The kind select is disabled as soon as anything references the
 * category, because moving it would re-label history; merging into a same-kind category
 * is the way out, and the hint says it.
 */

const KIND_LABELS: Record<CategoryKind, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
};

export type ManagedCategory = {
  id: string;
  name: string;
  kind: CategoryKind;
  transactionCount: number;
  budgetCount: number;
  recurringCount: number;
};

type RowMessage = { tone: "info" | "error"; text: string } | undefined;

export function CategoriesManager({ categories }: { categories: ManagedCategory[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; kind: CategoryKind } | null>(null);
  const [messages, setMessages] = useState<Record<string, RowMessage>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  const [merging, setMerging] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  function setMessage(id: string, tone: "info" | "error", text: string) {
    setMessages((current) => ({ ...current, [id]: { tone, text } }));
  }

  function save(category: ManagedCategory) {
    if (!draft) {
      return;
    }

    startSave(async () => {
      const outcome = await updateCategoryAction({ id: category.id, ...draft });

      if (outcome.status === "ok") {
        setEditingId(null);
        setDraft(null);
        setMessage(category.id, "info", "Catégorie mise à jour.");
        router.refresh();
        return;
      }

      // The refusal of a kind change is field-scoped on the server; surface its text
      // wherever it landed so the reason is never lost.
      const text =
        outcome.status === "invalid"
          ? Object.values(outcome.fieldErrors).flat()[0] ?? outcome.message
          : outcome.message;
      setMessage(category.id, "error", text);
    });
  }

  function runMerge(source: ManagedCategory) {
    setBusyId(source.id);
    setMessages((current) => ({ ...current, [source.id]: undefined }));

    void mergeCategoriesAction({ sourceId: source.id, targetId: mergeTarget }).then((outcome) => {
      setBusyId(null);

      if (outcome.status === "ok") {
        setMerging(null);
        setMergeTarget("");
        setMessage(source.id, "info", outcome.message ?? "Fusion effectuée.");
        router.refresh();
        return;
      }

      setMessage(source.id, "error", outcome.message);
    });
  }

  function runDelete(category: ManagedCategory) {
    setBusyId(category.id);

    void deleteCategoryAction({ id: category.id }).then((outcome) => {
      setBusyId(null);
      setConfirmingDelete(null);

      if (outcome.status === "ok") {
        setMessage(category.id, "info", "Catégorie supprimée.");
        router.refresh();
        return;
      }

      setMessage(category.id, "error", outcome.message);
    });
  }

  function usageText(category: ManagedCategory): string {
    const parts: string[] = [];
    if (category.transactionCount > 0) {
      parts.push(
        `${category.transactionCount} opération${category.transactionCount > 1 ? "s" : ""}`,
      );
    }
    if (category.budgetCount > 0) {
      parts.push(`${category.budgetCount} budget${category.budgetCount > 1 ? "s" : ""}`);
    }
    if (category.recurringCount > 0) {
      parts.push(
        `${category.recurringCount} série${category.recurringCount > 1 ? "s" : ""} récurrente${category.recurringCount > 1 ? "s" : ""}`,
      );
    }

    return parts.length === 0 ? "Aucune utilisation" : parts.join(" · ");
  }

  if (categories.length === 0) {
    return (
      <Notice tone="info">
        Aucune catégorie pour l&apos;instant. Créez-en une dans l&apos;onglet Opérations.
      </Notice>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Gestion des catégories</caption>
        <thead>
          <tr>
            <th scope="col" className={thClass}>
              Catégorie
            </th>
            <th scope="col" className={thClass}>
              Type
            </th>
            <th scope="col" className={thClass}>
              Utilisation
            </th>
            <th scope="col" className={thClass}>
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => {
            const editing = editingId === category.id && draft !== null;
            const message = messages[category.id];
            const used =
              category.transactionCount + category.budgetCount + category.recurringCount > 0;
            const sameKindTargets = categories.filter(
              (candidate) => candidate.id !== category.id && candidate.kind === category.kind,
            );

            return (
              <tr key={category.id}>
                <td className={tdClass}>
                  {editing ? (
                    <input
                      className={inputClass}
                      aria-label={`Nom de la catégorie ${category.name}`}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      autoFocus
                    />
                  ) : (
                    category.name
                  )}
                </td>
                <td className={tdClass}>
                  {editing ? (
                    <select
                      className={inputClass}
                      aria-label={`Type de la catégorie ${category.name}`}
                      value={draft.kind}
                      disabled={used}
                      onChange={(event) =>
                        setDraft({ ...draft, kind: event.target.value as CategoryKind })
                      }
                    >
                      {(Object.keys(KIND_LABELS) as CategoryKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    KIND_LABELS[category.kind]
                  )}
                  {editing && used ? (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Type verrouillé tant que la catégorie est utilisée — fusionnez-la vers
                      une catégorie du bon type si besoin.
                    </p>
                  ) : null}
                </td>
                <td className={tdClass}>
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    {usageText(category)}
                  </span>
                </td>
                <td className={tdClass}>
                  <div className="flex flex-col items-start gap-2">
                    {editing ? (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => save(category)}
                          disabled={isSaving}
                          className={submitClass}
                        >
                          {isSaving ? "..." : "Enregistrer"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setDraft(null);
                          }}
                          disabled={isSaving}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Annuler
                        </button>
                      </span>
                    ) : merging === category.id ? (
                      <span className="flex flex-wrap items-center gap-1">
                        <select
                          className={inputClass}
                          aria-label={`Fusionner ${category.name} vers`}
                          value={mergeTarget}
                          onChange={(event) => setMergeTarget(event.target.value)}
                        >
                          <option value="">Choisir la cible…</option>
                          {sameKindTargets.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => runMerge(category)}
                          disabled={busyId === category.id || mergeTarget === ""}
                          className={submitClass}
                        >
                          {busyId === category.id ? "..." : "Fusionner"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMerging(null);
                            setMergeTarget("");
                          }}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Annuler
                        </button>
                        {sameKindTargets.length === 0 ? (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            Aucune catégorie cible du même type.
                          </span>
                        ) : null}
                      </span>
                    ) : confirmingDelete === category.id ? (
                      <span className="flex max-w-80 flex-col gap-1">
                        <span className="text-xs">
                          Supprimer « {category.name} » ?{" "}
                          {category.transactionCount > 0
                            ? `${category.transactionCount} opération${category.transactionCount > 1 ? "s" : ""} perdront leur catégorie (les montants restent) ; `
                            : ""}
                          {category.budgetCount > 0
                            ? `${category.budgetCount} budget${category.budgetCount > 1 ? "s" : ""} seront supprimés.`
                            : "Aucun budget n'en dépend."}
                        </span>
                        <span className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => runDelete(category)}
                            disabled={busyId === category.id}
                            className="rounded-md bg-rose-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
                          >
                            {busyId === category.id ? "..." : "Confirmer"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(null)}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            Annuler
                          </button>
                        </span>
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({ name: category.name, kind: category.kind });
                            setEditingId(category.id);
                            setMessages((current) => ({ ...current, [category.id]: undefined }));
                          }}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Renommer
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMerging(category.id);
                            setMergeTarget("");
                            setMessages((current) => ({ ...current, [category.id]: undefined }));
                          }}
                          disabled={sameKindTargets.length === 0}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Fusionner
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingDelete(category.id);
                            setMessages((current) => ({ ...current, [category.id]: undefined }));
                          }}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Supprimer
                        </button>
                      </>
                    )}
                    {message ? (
                      <Notice tone={message.tone === "error" ? "error" : "info"}>
                        {message.text}
                      </Notice>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
