import { PageHeader, Section, SimpleTable, TextLink } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";

export default async function CompletedPage() {
  const user = await requireRole(["WORKER"]);
  const jobs = await db.serviceJob.findMany({
    where: { assignedWorkerId: user.id, status: "COMPLETED" },
    orderBy: { actualCompletion: "desc" },
    take: 100,
    include: { vehicle: { select: { registrationNumber: true } }, customer: { select: { name: true } } },
  });
  return (
    <>
      <PageHeader title="Completed Jobs" />
      <Section title={`${jobs.length} completed`}>
        <SimpleTable
          headers={["Service", "Customer", "Vehicle", "Completed"]}
          empty="No completed jobs yet"
          rows={jobs.map((j) => [<TextLink key="s" href={`/worker/jobs/${j.id}`}>{j.serviceNumber}</TextLink>, j.customer.name, j.vehicle.registrationNumber, dateTime(j.actualCompletion)])}
        />
      </Section>
    </>
  );
}
