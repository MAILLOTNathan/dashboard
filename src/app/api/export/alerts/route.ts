import { requireApiUser, unauthorizedResponse } from "@/lib/auth/guard";
import { createCsvResponse, EXPORT_ROW_LIMIT, toCsv, type CsvColumn } from "@/lib/csv";
import { ALERT_STATUSES, describeAlert } from "@/modules/alerts/domain";
import { listAlerts } from "@/modules/alerts/repository";

/**
 * CSV export of the alerts, one row per episode.
 *
 * `status` filters the file (`ACTIVE`, `DISMISSED`, `RESOLVED`); an absent or unknown
 * value exports everything. The reason is recomputed from the stored inputs by the same
 * `describeAlert` the screens use, so the file and the page can never tell different
 * stories. Instants are ISO 8601 in UTC — unambiguous once the file leaves its time
 * zone. The read is bounded by `EXPORT_ROW_LIMIT`.
 */
export const dynamic = "force-dynamic";

type AlertRow = {
  kind: string;
  status: string;
  triggeredAt: string;
  lastSeenAt: string;
  dismissedAt: string;
  resolvedAt: string;
  reason: string;
};

const COLUMNS: CsvColumn<AlertRow>[] = [
  { key: "kind", header: "type" },
  { key: "status", header: "statut" },
  { key: "triggeredAt", header: "declenchee_le" },
  { key: "lastSeenAt", header: "vue_le" },
  { key: "dismissedAt", header: "ecartee_le" },
  { key: "resolvedAt", header: "resolue_le" },
  { key: "reason", header: "raison" },
];

export async function GET(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get("status");
  const status = ALERT_STATUSES.find((value) => value === rawStatus);

  const alerts = await listAlerts(user.id, { status, take: EXPORT_ROW_LIMIT });

  const rows: AlertRow[] = alerts.map((alert) => ({
    kind: alert.kind,
    status: alert.status,
    triggeredAt: alert.triggeredAt.toISOString(),
    lastSeenAt: alert.lastSeenAt.toISOString(),
    dismissedAt: alert.dismissedAt?.toISOString() ?? "",
    resolvedAt: alert.resolvedAt?.toISOString() ?? "",
    reason: describeAlert({ kind: alert.kind, inputs: alert.inputs }).reason,
  }));

  return createCsvResponse(toCsv(rows, COLUMNS), "alertes.csv");
}
