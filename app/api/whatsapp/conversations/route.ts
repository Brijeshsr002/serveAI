import { authed } from "@/lib/api/route";
import { db } from "@/lib/db";
import { STAFF } from "@/lib/permissions";

export const GET = authed(STAFF, async () =>
  db.whatsappConversation.findMany({
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 200,
    include: { customer: { select: { id: true, name: true, phone: true } } },
  }),
);
