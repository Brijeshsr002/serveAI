import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { STAFF } from "@/lib/permissions";

export const GET = authed(STAFF, async () =>
  db.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      customer: { select: { id: true, name: true } },
      serviceJob: { select: { id: true, serviceNumber: true } },
    },
  }),
);
