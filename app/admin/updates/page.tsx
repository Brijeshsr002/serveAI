import { PageHeader, Section } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { CHANGELOG } from "@/lib/changelog";
import { dayShort } from "@/lib/format";

export default async function UpdatesPage() {
  await requireRole(["ADMIN"]);
  return (
    <>
      <PageHeader title="Updates" subtitle="What has been added to ServAI, newest first" />
      <div className="max-w-3xl space-y-4">
        {[...CHANGELOG].reverse().map((release) => (
          <Section key={release.version} title={`v${release.version}`} action={<span className="text-xs text-muted-foreground">{dayShort(release.date)}, {release.date.slice(0, 4)}</span>}>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {release.changes.map((change) => <li key={change}>{change}</li>)}
            </ul>
          </Section>
        ))}
      </div>
    </>
  );
}
