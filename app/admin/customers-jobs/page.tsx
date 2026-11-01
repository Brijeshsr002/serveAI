import { CustomersPanel } from "@/components/customers-panel";
import { PageTabs, pickTab } from "@/components/data-board";
import { GlobalSearch } from "@/components/global-search";
import { JobsPanel } from "@/components/jobs-panel";
import { PageHeader } from "@/components/ui-kit";
import { requireRole } from "@/lib/auth/page";
import { roleBase, STAFF } from "@/lib/permissions";

type Query = Record<string, string | string[] | undefined>;

/** A repeated parameter arrives as a list, which the search and filters below have no meaning for. */
const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function CustomersJobsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const user = await requireRole(STAFF);
  const base = roleBase[user.role];
  const query = await searchParams;
  const tab = pickTab(query.tab, ["jobs", "customers"] as const);
  const q = single(query.q);
  const view = single(query.view);
  const panel = tab === "jobs" ? await JobsPanel({ base, q, view, status: single(query.status) }) : await CustomersPanel({ base, q, view });
  return (
    <>
      <PageHeader title="Customers & Jobs" subtitle={panel.subtitle}>{panel.actions}</PageHeader>
      <div className="mb-4"><GlobalSearch base={base} /></div>
      <PageTabs
        label="Customers and jobs"
        param="tab"
        active={tab}
        keep={{ ...(view === "list" ? { view } : {}), ...(q ? { q } : {}) }}
        tabs={[{ key: "jobs", label: "Jobs board" }, { key: "customers", label: "Customers" }]}
      />
      {panel.body}
    </>
  );
}
