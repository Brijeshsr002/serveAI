import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeCustomer } from "./helpers";

it("stores the rupee sign and Tamil text", async () => {
  const c = await makeCustomer("919333333333", "பிரிஜேஷ் ₹");
  expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).name).toBe("பிரிஜேஷ் ₹");
});
