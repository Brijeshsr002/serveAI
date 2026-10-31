import { z } from "zod";
import { authed, ok } from "@/lib/api/route";
import { db } from "@/lib/db";
import { ADMIN_ONLY, STAFF } from "@/lib/permissions";
import { generateInvoice } from "@/lib/services/invoices";

const schema = z.object({ serviceJobId: z.string().min(1) });

export const GET = authed(ADMIN_ONLY, async () =>
  db.invoice.findMany({
    orderBy: { invoiceDate: "desc" },
    take: 200,
    include: { serviceJob: { select: { id: true, serviceNumber: true, customer: { select: { name: true } } } } },
  }),
);

export const POST = authed(STAFF, async ({ actor, body }) => {
  const { serviceJobId } = await body(schema);
  return ok(await generateInvoice(actor, serviceJobId), 201);
});
