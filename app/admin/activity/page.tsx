import { PageHeader, Section, SimpleTable } from "@/components/ui-kit";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";

export default async function ActivityPage() {
  const logs = await db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
  return (
    <>
      <PageHeader title="Activity Logs" subtitle="Latest 300 actions" />
      <Section title="Audit trail">
        <SimpleTable
          headers={["Time", "Actor", "Action", "Summary", "IP"]}
          rows={logs.map((l) => [dateTime(l.createdAt), l.actorRole, l.action, l.summary, l.ip ?? "—"])}
        />
      </Section>
    </>
  );
}
