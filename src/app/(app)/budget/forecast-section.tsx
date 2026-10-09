import Decimal from "decimal.js";
import Link from "next/link";
import {
  Badge,
  Card,
  Notice,
  StatCard,
  TableShell,
  tdClass,
  thClass,
} from "@/components/ui";
import { formatDateOnly, formatInstant, formatMonthLabel, monthKeysFrom, monthRange, parseMonthKey, shiftMonthKey, toDateOnlyString } from "@/lib/dates";
import { DEFAULT_CURRENCY, formatMoney, type Currency } from "@/lib/money";
import {
  ensureRecurringOccurrences,
  findRecurringEntry,
  findSalarySetting,
  findTransactionByExternalRef,
  listAccounts,
  listCategories,
  listRecurringEntries,
  listRecurringOccurrences,
  listSalaryRates,
  listTransactionsForSeries,
  listWorkDays,
  sumTransactionsByCurrency,
} from "@/modules/budget/repository";
import { buildSimulatedBalances } from "@/modules/budget/projection";
import {
  OCCURRENCE_STATUS_LABELS,
  plannedContributions,
  RECURRENCE_FREQUENCY_LABELS,
  signedForecastAmount,
  summariseForecastMonth,
  toRecurringEntryFormInitialValues,
  type ForecastContribution,
  type ForecastType,
  type RecurringOccurrenceStatus,
} from "@/modules/budget/recurrence";
import {
  computeSalarySummary,
  resolveSalaryRate,
  SALARY_CATEGORY_NAME,
  salaryBookingRef,
  salaryMonthContribution,
  type WorkDayRecord,
} from "@/modules/budget/salary";
import { DeleteRecurringButton } from "./delete-recurring-button";
import { OccurrenceActions } from "./occurrence-actions";
import { RecurringEntryForm } from "./recurring-entry-form";
import { SalaryBookingRow } from "./salary-booking-row";

const TYPE_LABELS: Record<ForecastType, string> = {
  INCOME: "Recette",
  EXPENSE: "Dépense",
};

const STATUS_TONES: Record<
  RecurringOccurrenceStatus,
  "neutral" | "positive" | "warning"
> = {
  PENDING: "neutral",
  CONFIRMED: "positive",
  SKIPPED: "neutral",
  DISMISSED: "neutral",
};

/**
 * "Prévisions" tab: the month's expected occurrences, and the series that produce them.
 *
 * Opening the month materialises its occurrences, idempotently: the unique
 * (recurringId, date) plus `skipDuplicates` make the write safe to repeat, and a
 * decided occurrence keeps its row, so it is never offered twice. Nothing here counts
 * in a total until it is confirmed — confirming goes through the very same creation
 * path as a manual entry; passing or discarding writes a decision and no transaction.
 * The month's salary prévision is computed from the simulator instead of being stored:
 * it follows the calendar day by day, and recording it calls the same booking action as
 * the Salaire tab, so the two can never disagree.
 */
export async function ForecastSection({
  userId,
  monthKey,
  editRecurringId,
}: {
  userId: string;
  /** `YYYY-MM`, the month shared by every tab. */
  monthKey: string;
  /** `?editRecurring=`, an identifier to look up: a foreign one finds nothing. */
  editRecurringId?: string;
}) {
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);
  const monthLabel = formatMonthLabel(year, month);

  await ensureRecurringOccurrences(userId, year, month);

  // The scheduler reads the six months after the displayed one: their whole calendar and
  // their salary bookings are fetched once here, so the rows and the monthly prévision
  // below can never disagree about what is planned.
  const upcomingKeys = monthKeysFrom(shiftMonthKey(monthKey, 1), 6);
  const firstUpcoming = parseMonthKey(upcomingKeys[0]);
  const lastUpcoming = parseMonthKey(upcomingKeys[upcomingKeys.length - 1]);
  const upcomingRange = {
    from: monthRange(firstUpcoming.year, firstUpcoming.month).start,
    to: monthRange(lastUpcoming.year, lastUpcoming.month).end,
  };

  const [
    entries,
    occurrences,
    accounts,
    categories,
    salarySetting,
    rates,
    workDays,
    salaryBooking,
    upcomingWorkDays,
    upcomingBookings,
    recordedBefore,
    upcomingRecorded,
    editTarget,
  ] = await Promise.all([
    listRecurringEntries(userId),
    listRecurringOccurrences(userId, { from: range.start, to: range.end }),
    listAccounts(userId),
    listCategories(userId),
    findSalarySetting(userId),
    listSalaryRates(userId),
    // The month's calendar, read exactly like the Salaire tab reads it: the prévision
    // and the booking recompute the same figures from the same rows.
    listWorkDays(userId, { from: range.start, to: range.end }),
    findTransactionByExternalRef(userId, salaryBookingRef(year, month)),
    // The scheduler's salary: one read for the window's calendar, one booking lookup per
    // month (indexed through the stable `salary:YYYY-MM` reference).
    listWorkDays(userId, upcomingRange),
    Promise.all(
      upcomingKeys.map((key) => {
        const parsed = parseMonthKey(key);
        return findTransactionByExternalRef(
          userId,
          salaryBookingRef(parsed.year, parsed.month),
        );
      }),
    ),
    // The simulated balance starts from the recorded cumulative strictly before the
    // window, then walks the window's recorded operations month by month.
    sumTransactionsByCurrency(userId, { before: upcomingRange.from }),
    listTransactionsForSeries(userId, { from: upcomingRange.from, to: upcomingRange.to }),
    editRecurringId ? findRecurringEntry(userId, editRecurringId) : Promise.resolve(null),
  ]);

  const entryEditing = editTarget;
  const entryEditTargetIsHidden = Boolean(editRecurringId) && editTarget === null;

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currency]));
  const pending = occurrences.filter((occurrence) => occurrence.status === "PENDING");
  const decided = occurrences.filter((occurrence) => occurrence.status !== "PENDING");

  // Salary prévision: computed from the simulator, never stored — it follows the
  // calendar and becomes the first row of the month's échéances while it is not
  // registered yet. The rate is the one in force for the displayed month.
  const displayedRate = resolveSalaryRate(rates, year, month);
  const salarySummary = displayedRate
    ? computeSalarySummary(workDays, displayedRate.hourlyRate)
    : null;
  const salaryAccounts = salarySetting
    ? accounts.filter((account) => account.currency === salarySetting.currency)
    : [];
  const workedDayCount = workDays.filter((day) => day.status === "WORKED").length;
  const lastClickedDay = workDays.length > 0 ? workDays[workDays.length - 1] : null;
  const salaryPending =
    salarySetting !== null &&
    displayedRate !== null &&
    salaryBooking === null &&
    lastClickedDay !== null;

  // The month's prévisionnel: every expected movement, whatever its source — the series
  // échéances and the salary prévision. Confirmed ones count (a prévision that came
  // true), passed and dismissed ones do not; the domain rule decides, here we only
  // hand in the contributions.
  const contributions: ForecastContribution[] = [];
  for (const occurrence of occurrences) {
    const entry = entriesById.get(occurrence.recurringId);
    if (!entry) {
      continue;
    }
    contributions.push({
      currency: currencyByAccount.get(entry.accountId) ?? DEFAULT_CURRENCY,
      type: entry.type,
      amount: entry.amount,
      status: occurrence.status,
    });
  }

  // One salary rule for the displayed month and the scheduler alike: a registered month
  // counts the amount that will really land, a month of clicked days its simulation, an
  // untouched calendar nothing at all.
  const salaryContribution = salaryMonthContribution({
    rate:
      salarySetting && displayedRate
        ? { hourlyRate: displayedRate.hourlyRate, currency: salarySetting.currency }
        : null,
    days: workDays,
    booking: salaryBooking,
  });

  if (salaryContribution) {
    contributions.push(salaryContribution);
  }

  const forecastTotals = summariseForecastMonth(contributions);

  // The scheduler looks at the months **after** the displayed one: six months of planned
  // occurrences, computed from the series (nothing is materialised ahead of time), each
  // completed with its salary — the simulation of its clicked days, or the amount already
  // booked. A month nobody clicked carries no salary: an empty calendar is not a zero.
  const upcomingWorkDaysByMonth = new Map<string, WorkDayRecord[]>();

  for (const day of upcomingWorkDays) {
    const key = toDateOnlyString(day.date).slice(0, 7);
    const bucket = upcomingWorkDaysByMonth.get(key);

    if (bucket) {
      bucket.push(day);
    } else {
      upcomingWorkDaysByMonth.set(key, [day]);
    }
  }

  // Recorded operations inside the window, bucketed per month and currency: they already
  // exist, so the simulated balance advances with them — never projected a second time.
  const recordedByMonth = new Map<string, Map<Currency, Decimal>>();

  for (const transaction of upcomingRecorded.transactions) {
    const key = toDateOnlyString(transaction.operationDate).slice(0, 7);
    const byCurrency = recordedByMonth.get(key) ?? new Map<Currency, Decimal>();

    byCurrency.set(
      transaction.currency,
      (byCurrency.get(transaction.currency) ?? new Decimal(0)).plus(transaction.amount),
    );
    recordedByMonth.set(key, byCurrency);
  }

  const monthPlans = upcomingKeys.map((key, index) => {
    const parsed = parseMonthKey(key);
    const monthRate = resolveSalaryRate(rates, parsed.year, parsed.month);
    const salary = salaryMonthContribution({
      rate:
        salarySetting && monthRate
          ? { hourlyRate: monthRate.hourlyRate, currency: salarySetting.currency }
          : null,
      days: upcomingWorkDaysByMonth.get(key) ?? [],
      booking: upcomingBookings[index],
    });
    const monthContributions = plannedContributions(
      entries,
      parsed.year,
      parsed.month,
      currencyByAccount,
    );

    if (salary) {
      monthContributions.push(salary);
    }

    // Only the not-yet-recorded movements advance the simulated balance: a confirmed one
    // (a booked salary) is already a recorded operation of its month.
    const pendingNet = new Map<Currency, Decimal>();
    for (const totals of summariseForecastMonth(
      monthContributions.filter((contribution) => contribution.status === "PENDING"),
    )) {
      pendingNet.set(totals.currency, totals.net);
    }

    return {
      key,
      label: formatMonthLabel(parsed.year, parsed.month),
      totals: summariseForecastMonth(monthContributions),
      salary,
      recorded: recordedByMonth.get(key) ?? new Map<Currency, Decimal>(),
      pendingNet,
    };
  });

  // The simulated balance: the currency's recorded cumulative before the window, advanced
  // month by month. A truncated window read would make the monthly sums partial, so the
  // column is left out rather than shown wrong.
  const simulatedBalances = upcomingRecorded.truncated
    ? null
    : buildSimulatedBalances({
        recordedBefore,
        months: monthPlans.map((plan) => ({
          key: plan.key,
          recorded: plan.recorded,
          pending: plan.pendingNet,
        })),
      });
  const balancesByMonth = new Map(
    (simulatedBalances ?? []).map((entry) => [entry.key, entry.balances]),
  );

  // "Today" is the UTC calendar day, like every date-only value in the project: marking
  // an occurrence late cannot shift because of a display time zone.
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return (
    <>
      <Card
        title={`Échéances — ${monthLabel}`}
        description="Une échéance ne compte dans aucun total tant qu'elle n'est pas confirmée : confirmer crée l'opération dans le mois, passer ou écarter enregistre une décision sans aucune écriture."
      >
        <form method="get" action="/budget" className="mb-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="forecast" />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Mois affiché</span>
            <input
              type="month"
              name="month"
              defaultValue={monthKey}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            Afficher
          </button>
        </form>

        {forecastTotals.length > 0 ? (
          <div className="mb-4 flex flex-col gap-2">
            <div className="grid gap-3 sm:grid-cols-3">
              {forecastTotals.map((totals) => (
                <div key={totals.currency} className="contents">
                  <StatCard
                    label={`Recettes prévues (${totals.currency})`}
                    value={formatMoney({ amount: totals.income, currency: totals.currency })}
                  />
                  <StatCard
                    label={`Dépenses prévues (${totals.currency})`}
                    value={formatMoney({ amount: totals.expenses, currency: totals.currency })}
                  />
                  <StatCard
                    label={`Solde prévisionnel (${totals.currency})`}
                    value={formatMoney({ amount: totals.net, currency: totals.currency })}
                    tone={totals.net.isNegative() ? "negative" : "positive"}
                    hint={`${totals.count} mouvement${totals.count > 1 ? "s" : ""} attendu${totals.count > 1 ? "s" : ""}${
                      totals.confirmedCount > 0
                        ? `, dont ${totals.confirmedCount} confirmé${totals.confirmedCount > 1 ? "s" : ""}`
                        : ""
                    }.`}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Prévisionnel du mois : échéances des séries et salaire simulé, confirmés
              compris ; passés et écartés exclus. Aucune devise n&apos;est convertie —
              seules les opérations enregistrées entrent dans les totaux réels.
            </p>
          </div>
        ) : null}

        {pending.length === 0 && !salaryPending ? (
          <Notice tone="info">
            {entries.length === 0
              ? `Aucune série n'est définie : les échéances de ${monthLabel} apparaîtront ici dès qu'une série existera, ci-dessous.`
              : `Aucune échéance à traiter en ${monthLabel} : les séries ne couvrent pas ce mois, ou toutes ses échéances ont déjà reçu une décision.`}
          </Notice>
        ) : (
          <TableShell caption={`Échéances à traiter — ${monthLabel}`}>
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Date
                </th>
                <th scope="col" className={thClass}>
                  Libellé
                </th>
                <th scope="col" className={thClass}>
                  Nature
                </th>
                <th scope="col" className={thClass}>
                  Compte
                </th>
                <th scope="col" className={thClass}>
                  Catégorie
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Montant
                </th>
                <th scope="col" className={thClass}>
                  Décision
                </th>
              </tr>
            </thead>
            <tbody>
              {salaryPending && salarySetting && salarySummary && lastClickedDay ? (
                <tr>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    {formatDateOnly(lastClickedDay.date)}
                  </td>
                  <td className={tdClass}>
                    {SALARY_CATEGORY_NAME}
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      Simulé : {workDays.length} jour
                      {workDays.length > 1 ? "s" : ""} cliqué
                      {workDays.length > 1 ? "s" : ""}
                      {workedDayCount > 0
                        ? `, dont ${workedDayCount} travaillé${workedDayCount > 1 ? "s" : ""}`
                        : ""}
                    </span>
                  </td>
                  <td className={tdClass}>Recette</td>
                  <td className={tdClass}>{salaryAccounts[0]?.name ?? "—"}</td>
                  <td className={tdClass}>{SALARY_CATEGORY_NAME}</td>
                  <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                    {formatMoney({
                      amount: salarySummary.totalAmount,
                      currency: salarySetting.currency,
                    })}
                  </td>
                  <td className={tdClass}>
                    {salaryAccounts.length === 0 ? (
                      <span className="text-xs text-amber-700 dark:text-amber-300">
                        Aucun compte en {salarySetting.currency} : créez-en un dans
                        l&apos;onglet Opérations pour enregistrer la recette.
                      </span>
                    ) : (
                      <SalaryBookingRow
                        monthKey={monthKey}
                        accounts={salaryAccounts.map((account) => ({
                          id: account.id,
                          name: account.name,
                        }))}
                        defaultDate={toDateOnlyString(lastClickedDay.date)}
                      />
                    )}
                  </td>
                </tr>
              ) : null}

              {pending.map((occurrence) => {
                const entry = entriesById.get(occurrence.recurringId);
                if (!entry) {
                  // Unreachable in practice: a series is kept while one of its
                  // occurrences carries a decision, and a pending one is waiting for
                  // exactly that. Rendering nothing beats inventing a row.
                  return null;
                }

                const currency = currencyByAccount.get(entry.accountId) ?? DEFAULT_CURRENCY;
                const isLate = occurrence.date.getTime() < todayUTC;

                return (
                  <tr key={occurrence.id}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {formatDateOnly(occurrence.date)}{" "}
                      {isLate ? <Badge tone="warning">En retard</Badge> : null}
                    </td>
                    <td className={tdClass}>{entry.label}</td>
                    <td className={tdClass}>{TYPE_LABELS[entry.type]}</td>
                    <td className={tdClass}>{entry.accountName}</td>
                    <td className={tdClass}>{entry.categoryName ?? "Sans catégorie"}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {formatMoney({ amount: signedForecastAmount(entry.type, entry.amount), currency })}
                    </td>
                    <td className={tdClass}>
                      <OccurrenceActions occurrenceId={occurrence.id} label={entry.label} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}

        {salarySetting && salaryBooking === null && lastClickedDay === null ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Salaire — aucun jour cliqué en {monthLabel} : la prévision apparaîtra ici dès
            qu&apos;une journée sera planifiée.{" "}
            <Link
              href={`/budget?month=${monthKey}&tab=salary`}
              className="underline underline-offset-2"
            >
              Planifier dans Salaire
            </Link>
            .
          </p>
        ) : null}

        {decided.length > 0 || salaryBooking ? (
          <div className="mt-6 flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              Décisions de {monthLabel}
            </h3>

            <TableShell caption={`Décisions — ${monthLabel}`}>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Date
                  </th>
                  <th scope="col" className={thClass}>
                    Libellé
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Montant
                  </th>
                  <th scope="col" className={thClass}>
                    Décision
                  </th>
                  <th scope="col" className={thClass}>
                    Décidé le
                  </th>
                </tr>
              </thead>
              <tbody>
                {salaryBooking ? (
                  <tr>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {formatDateOnly(salaryBooking.operationDate)}
                    </td>
                    <td className={tdClass}>
                      {salaryBooking.label}
                      {" — "}
                      <Link
                        href={`/budget?month=${monthKey}&tab=operations&edit=${salaryBooking.id}`}
                        className="underline underline-offset-2"
                      >
                        voir l&apos;opération
                      </Link>
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {formatMoney({
                        amount: salaryBooking.amount,
                        currency: salaryBooking.currency,
                      })}
                    </td>
                    <td className={tdClass}>
                      <Badge tone="positive">Confirmée</Badge>
                    </td>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {formatInstant(salaryBooking.createdAt)}
                    </td>
                  </tr>
                ) : null}

                {decided.map((occurrence) => {
                  const entry = entriesById.get(occurrence.recurringId);
                  if (!entry) {
                    return null;
                  }

                  const currency = currencyByAccount.get(entry.accountId) ?? DEFAULT_CURRENCY;

                  return (
                    <tr key={occurrence.id}>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {formatDateOnly(occurrence.date)}
                      </td>
                      <td className={tdClass}>
                        {entry.label}
                        {occurrence.status === "CONFIRMED" && occurrence.transactionId ? (
                          <>
                            {" — "}
                            <Link
                              href={`/budget?month=${monthKey}&tab=operations&edit=${occurrence.transactionId}`}
                              className="underline underline-offset-2"
                            >
                              voir l&apos;opération
                            </Link>
                          </>
                        ) : null}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {formatMoney({ amount: signedForecastAmount(entry.type, entry.amount), currency })}
                      </td>
                      <td className={tdClass}>
                        <Badge tone={STATUS_TONES[occurrence.status]}>
                          {OCCURRENCE_STATUS_LABELS[occurrence.status]}
                        </Badge>
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {occurrence.decidedAt ? formatInstant(occurrence.decidedAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Passée, écartée ou confirmée : chaque décision reste enregistrée avec sa
              date, et ne se réécrit pas.
            </p>
          </div>
        ) : null}
      </Card>

      <Card
        title="Séries récurrentes"
        description="Une série décrit une recette ou une dépense attendue — loyer, abonnement, taxe, salaire. Elle n'écrit rien dans le budget : chaque mois, elle alimente la liste des échéances à traiter, et le montant se confirme dans la devise du compte, sans conversion. Cadence mensuelle, trimestrielle ou annuelle."
      >
        {entryEditTargetIsHidden ? (
          <div className="mb-4">
            <Notice tone="warning">
              La série demandée n&apos;existe plus, ou ne fait pas partie de vos données :
              le formulaire reste en mode création.
            </Notice>
          </div>
        ) : null}

        {entryEditing ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">
              Modifier la série « {entryEditing.label} »
            </p>
            <RecurringEntryForm
              key={entryEditing.id}
              accounts={accounts}
              categories={categories}
              defaultStartDate={`${monthKey}-01`}
              editing={toRecurringEntryFormInitialValues(entryEditing)}
              cancelHref={`/budget?month=${monthKey}&tab=forecast`}
            />
          </div>
        ) : (
          <RecurringEntryForm
            accounts={accounts}
            categories={categories}
            defaultStartDate={`${monthKey}-01`}
          />
        )}

        {entries.length === 0 ? (
          <div className="mt-4">
            <Notice tone="info">
              Aucune série pour le moment : la première créée fera apparaître ses
              échéances dans le mois affiché.
            </Notice>
          </div>
        ) : (
          <div className="mt-4">
            <TableShell caption="Séries récurrentes">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>
                    Libellé
                  </th>
                  <th scope="col" className={thClass}>
                    Nature
                  </th>
                  <th scope="col" className={`${thClass} text-right`}>
                    Montant
                  </th>
                  <th scope="col" className={thClass}>
                    Fréquence
                  </th>
                  <th scope="col" className={thClass}>
                    Compte
                  </th>
                  <th scope="col" className={thClass}>
                    Catégorie
                  </th>
                  <th scope="col" className={thClass}>
                    Début
                  </th>
                  <th scope="col" className={thClass}>
                    Fin
                  </th>
                  <th scope="col" className={thClass}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const currency = currencyByAccount.get(entry.accountId) ?? DEFAULT_CURRENCY;

                  return (
                    <tr
                      key={entry.id}
                      className={
                        entryEditing?.id === entry.id
                          ? "bg-amber-50 dark:bg-amber-950/30"
                          : undefined
                      }
                    >
                      <td className={tdClass}>{entry.label}</td>
                      <td className={tdClass}>{TYPE_LABELS[entry.type]}</td>
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {formatMoney({ amount: signedForecastAmount(entry.type, entry.amount), currency })}
                      </td>
                      <td className={tdClass}>
                        {RECURRENCE_FREQUENCY_LABELS[entry.frequency]}
                      </td>
                      <td className={tdClass}>{entry.accountName}</td>
                      <td className={tdClass}>{entry.categoryName ?? "Sans catégorie"}</td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {formatDateOnly(entry.startDate)}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>
                        {entry.endDate ? formatDateOnly(entry.endDate) : "—"}
                      </td>
                      <td className={tdClass}>
                        <div className="flex flex-col items-start gap-1">
                          <Link
                            href={`/budget?month=${monthKey}&tab=forecast&editRecurring=${entry.id}`}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            Modifier
                          </Link>
                          <DeleteRecurringButton entryId={entry.id} label={entry.label} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>

            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Supprimer une série sans décision la retire avec ses échéances en attente ;
              une série qui porte déjà des échéances traitées est conservée pour l&apos;audit
              et s&apos;arrête par sa date de fin.
            </p>
          </div>
        )}
      </Card>

      <Card
        title="Échéancier des 6 prochains mois"
        description="Échéances à venir des séries, calculées depuis le calendrier, salaire compris : la simulation des jours cliqués dans Salaire (« simulé »), ou le montant déjà enregistré (« enregistré »). Rien n'est matérialisé d'avance, un mois sans jour cliqué n'affiche aucun salaire — jamais un zéro — et aucune devise n'est convertie."
      >
        {entries.length === 0 && monthPlans.every((plan) => plan.salary === null) ? (
          <Notice tone="info">
            Aucune série et aucun jour de salaire cliqué : l&apos;échéancier se remplira dès
            la première série définie, ou dès que des jours seront planifiés dans Salaire.
          </Notice>
        ) : (
          <>
          <TableShell caption="Échéancier des 6 prochains mois">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  Mois
                </th>
                <th scope="col" className={thClass}>
                  Devise
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Recettes prévues
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Dont salaire
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Dépenses prévues
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Solde
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Solde simulé
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Échéances
                </th>
              </tr>
            </thead>
            <tbody>
              {monthPlans.map((upcoming) =>
                upcoming.totals.length === 0 ? (
                  <tr key={upcoming.key}>
                    <td className={tdClass}>{upcoming.label}</td>
                    <td className={`${tdClass} text-zinc-500 dark:text-zinc-400`} colSpan={7}>
                      Aucune échéance prévue
                    </td>
                  </tr>
                ) : (
                  upcoming.totals.map((totals) => {
                    const balance =
                      balancesByMonth.get(upcoming.key)?.get(totals.currency) ?? null;

                    return (
                    <tr key={`${upcoming.key}|${totals.currency}`}>
                      <td className={tdClass}>{upcoming.label}</td>
                      <td className={tdClass}>{totals.currency}</td>
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {formatMoney({ amount: totals.income, currency: totals.currency })}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {upcoming.salary !== null && upcoming.salary.currency === totals.currency ? (
                          <>
                            {formatMoney({
                              amount: upcoming.salary.amount,
                              currency: upcoming.salary.currency,
                            })}
                            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                              {upcoming.salary.status === "CONFIRMED"
                                ? "enregistré"
                                : "simulé"}
                            </span>
                          </>
                        ) : (
                          <span className="text-zinc-500 dark:text-zinc-400">—</span>
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {formatMoney({ amount: totals.expenses, currency: totals.currency })}
                      </td>
                      <td
                        className={`${tdClass} whitespace-nowrap text-right tabular-nums ${
                          totals.net.isNegative() ? "text-rose-700 dark:text-rose-400" : ""
                        }`}
                      >
                        {formatMoney({ amount: totals.net, currency: totals.currency })}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                        {balance !== null ? (
                          formatMoney({ amount: balance, currency: totals.currency })
                        ) : (
                          <span className="text-zinc-500 dark:text-zinc-400">—</span>
                        )}
                      </td>
                      <td className={`${tdClass} text-right tabular-nums`}>{totals.count}</td>
                    </tr>
                    );
                  })
                ),
              )}
            </tbody>
          </TableShell>

            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Solde simulé : cumul enregistré de la devise avant la période, avancé mois
              par mois par les opérations déjà saisies et les mouvements prévus (échéances
              en attente, salaire simulé) — chaque mouvement ne compte qu&apos;une fois.
              « — » : aucune opération enregistrée dans cette devise, un solde inconnu
              n&apos;est pas un zéro.
            </p>
            {simulatedBalances === null ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Lecture de la période tronquée (trop d&apos;opérations) : le solde simulé
                n&apos;est pas calculé, plutôt que calculé à moitié.
              </p>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
