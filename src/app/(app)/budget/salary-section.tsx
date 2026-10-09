import type Decimal from "decimal.js";
import { Card, Notice, StatCard } from "@/components/ui";
import {
  formatMonthLabel,
  monthRange,
  parseMonthKey,
  toDateOnlyString,
} from "@/lib/dates";
import { formatMoney, toDecimalString } from "@/lib/money";
import {
  computeSalarySummary,
  monthCalendarCells,
  resolveSalaryRate,
  SALARY_CATEGORY_NAME,
  salaryBookingRef,
  salaryEquivalents,
} from "@/modules/budget/salary";
import {
  findSalarySetting,
  findTransactionByExternalRef,
  listAccounts,
  listSalaryRates,
  listWorkDays,
} from "@/modules/budget/repository";
import { RecordedSalaryNotice } from "./salary-booking-recorded";
import { SalaryBookingForm } from "./salary-booking-form";
import { SalaryForm } from "./salary-form";
import { WorkCalendar, type WorkCalendarDay } from "./work-calendar";

/** "7,5 h": hours as a human reads them; the stored decimal stays on the server. */
function formatHours(value: Decimal): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(
    value.toNumber(),
  )} h`;
}

/**
 * "Salaire" tab: a wage and a calendar of days planned then worked.
 *
 * The simulation reads its own two tables; writing into the accounts is a deliberate,
 * separate click (« Enregistrer la recette ») that creates one income transaction for the
 * month — category « Salaire », created when missing. Until that click the simulated
 * amounts stay out of the account and budget totals, and the booked entry is never
 * counted twice. The month picker belongs to this tab because the calendar is consulted
 * month by month, like the operations.
 */
export async function SalarySection({
  userId,
  monthKey,
}: {
  userId: string;
  /** `YYYY-MM`, the month shared by every tab. */
  monthKey: string;
}) {
  const { year, month } = parseMonthKey(monthKey);
  const range = monthRange(year, month);
  const monthLabel = formatMonthLabel(year, month);

  const [setting, rates, workDays, accounts, booking] = await Promise.all([
    findSalarySetting(userId),
    listSalaryRates(userId),
    listWorkDays(userId, { from: range.start, to: range.end }),
    listAccounts(userId),
    findTransactionByExternalRef(userId, salaryBookingRef(year, month)),
  ]);

  const rate = resolveSalaryRate(rates, year, month);

  // The month picker belongs to this tab because both the calendar and the monthly rate
  // are consulted month by month.
  const monthPicker = (
    <form method="get" action="/budget" className="mb-4 flex flex-wrap items-end gap-2">
      <input type="hidden" name="tab" value="salary" />

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
  );

  if (!setting || !rate) {
    return (
      <Card
        title={`Salaire — ${monthLabel}`}
        description="Le simulateur transforme des heures cliquées sur un calendrier en montants, à partir d'un taux horaire mensuel : un taux s'applique à partir du mois saisi, jusqu'au prochain changement. La recette du mois s'enregistre ensuite en un clic, dans la catégorie « Salaire » : rien n'est écrit avant ce clic."
      >
        {monthPicker}

        <div className="flex flex-col gap-3">
          <Notice tone="info">
            {setting
              ? `Aucun taux horaire pour ${monthLabel} ni avant : saisissez le taux de ce mois pour activer la simulation — il s'appliquera à partir de ${monthLabel}, jusqu'au prochain taux saisi.`
              : `Définissez d'abord le taux horaire de ${monthLabel} : le calendrier s'active ensuite.`}
          </Notice>
          <SalaryForm
            monthKey={monthKey}
            monthLabel={monthLabel}
            editing={
              setting
                ? {
                    hourlyRate: "",
                    hoursPerDay: toDecimalString(setting.hoursPerDay),
                    currency: setting.currency,
                  }
                : null
            }
          />
        </div>
      </Card>
    );
  }

  const currency = setting.currency;
  const summary = computeSalarySummary(workDays, rate.hourlyRate);
  const equivalents = salaryEquivalents(rate.hourlyRate, setting.hoursPerDay);
  const days: WorkCalendarDay[] = workDays.map((day) => ({
    date: toDateOnlyString(day.date),
    status: day.status,
    hours: toDecimalString(day.hours),
  }));
  const hasClickedDays = workDays.length > 0;
  // Booking: only accounts in the salary currency are offered; the action refuses any
  // other rather than converting between currencies.
  const salaryAccounts = accounts.filter((account) => account.currency === currency);
  // Default operation date: the last clicked day — the month is recorded as it stands,
  // planned days included.
  const lastClickedDay = workDays.length > 0 ? workDays[workDays.length - 1] : null;

  return (
    <Card
      title={`Salaire — ${monthLabel}`}
      description={`Simulation à partir d'un taux horaire de ${formatMoney({
        amount: rate.hourlyRate,
        currency,
      })} — en vigueur depuis ${formatMonthLabel(rate.year, rate.month)}. Un jour cliqué est d'abord prévu (budget simulé), puis confirmé travaillé quand il a réellement lieu. Le simulateur n'écrit rien tout seul : la recette du mois s'enregistre en un clic, une seule fois.`}
    >
      {monthPicker}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={`Taux horaire (${currency})`}
          value={formatMoney({ amount: rate.hourlyRate, currency })}
          hint={`Équivalents indicatifs : ${formatMoney({
            amount: equivalents.daily,
            currency,
          })} / jour (${formatHours(setting.hoursPerDay)}) · ${formatMoney({
            amount: equivalents.weekly,
            currency,
          })} / semaine (5 jours) · ${formatMoney({
            amount: equivalents.monthly,
            currency,
          })} / mois.`}
        />
        <StatCard
          label="Travaillé (mois)"
          value={formatMoney({ amount: summary.workedAmount, currency })}
          hint={`${formatHours(summary.workedHours)} confirmées sur le calendrier.`}
          tone={summary.workedAmount.isZero() ? "neutral" : "positive"}
        />
        <StatCard
          label="Prévu (mois)"
          value={formatMoney({ amount: summary.plannedAmount, currency })}
          hint={`${formatHours(summary.plannedHours)} planifiées, pas encore confirmées.`}
        />
        <StatCard
          label="Total simulé"
          value={formatMoney({ amount: summary.totalAmount, currency })}
          hint={`Réalisé + prévu : ${formatHours(summary.totalHours)}, chaque jour compté une fois.`}
        />
      </div>

      {!hasClickedDays ? (
        <div className="mt-4">
          <Notice tone="info">
            Aucun jour cliqué pour {formatMonthLabel(year, month)} : les montants sont à
            zéro parce que rien n&apos;est planifié, pas parce qu&apos;une donnée manque.
            Cliquez un jour ci-dessous pour le planifier.
          </Notice>
        </div>
      ) : null}

      <div className="mt-4">
        <WorkCalendar
          cells={monthCalendarCells(year, month)}
          days={days}
          todayKey={toDateOnlyString(new Date())}
        />
      </div>

      <section className="mt-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <h3 className="text-sm font-medium">Enregistrer la recette du mois</h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Crée une opération de recette, catégorie « {SALARY_CATEGORY_NAME} », avec le
          montant simulé du mois : jours prévus et travaillés, chacun compté une fois.
          Une seule recette par mois, et jamais écrite sans ce clic.
        </p>

        <div className="mt-3">
          {summary.totalAmount.isZero() ? (
            <Notice tone="info">
              Aucun jour cliqué pour {formatMonthLabel(year, month)} : planifiez au
              moins un jour dans le calendrier pour pouvoir enregistrer la recette.
            </Notice>
          ) : booking ? (
            <RecordedSalaryNotice monthKey={monthKey} booking={booking} />
          ) : salaryAccounts.length === 0 ? (
            <Notice tone="warning">
              Aucun compte en {currency} : créez-en un dans l&apos;onglet Opérations pour
              pouvoir enregistrer la recette (aucune conversion n&apos;est faite).
            </Notice>
          ) : (
            <SalaryBookingForm
              monthKey={monthKey}
              accounts={salaryAccounts.map((account) => ({
                id: account.id,
                name: account.name,
              }))}
              defaultDate={
                lastClickedDay
                  ? toDateOnlyString(lastClickedDay.date)
                  : toDateOnlyString(new Date())
              }
              amountLabel={formatMoney({ amount: summary.totalAmount, currency })}
            />
          )}
        </div>
      </section>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">
          Modifier le taux horaire — {formatMoney({ amount: rate.hourlyRate, currency })}{" "}
          en vigueur depuis {formatMonthLabel(rate.year, rate.month)}
        </summary>
        <div className="pt-3">
          <SalaryForm
            monthKey={monthKey}
            monthLabel={monthLabel}
            editing={{
              hourlyRate: toDecimalString(rate.hourlyRate),
              hoursPerDay: toDecimalString(setting.hoursPerDay),
              currency: setting.currency,
            }}
          />
        </div>
      </details>
    </Card>
  );
}
