import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Prisma.TransactionClient;
export type DbClient = PrismaClient | Tx;

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Atomically increments a named counter; safe under concurrent requests. */
export async function nextSequence(key: string, client: DbClient = db): Promise<number> {
  const rows = await client.$queryRaw<{ value: number }[]>`
    INSERT INTO sequences (key, value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET value = sequences.value + 1
    RETURNING value`;
  return rows[0].value;
}

const pad = (n: number) => String(n).padStart(6, "0");

export const nextCustomerCode = async (c: DbClient = db) => `CUS-${pad(await nextSequence("customer", c))}`;
export const nextVehicleCode = async (c: DbClient = db) => `VEH-${pad(await nextSequence("vehicle", c))}`;

export async function nextServiceNumber(c: DbClient = db) {
  const year = new Date().getFullYear();
  return `SRV-${year}-${pad(await nextSequence(`service-${year}`, c))}`;
}

export async function nextInvoiceNumber(c: DbClient = db) {
  const year = new Date().getFullYear();
  return `INV-${year}-${pad(await nextSequence(`invoice-${year}`, c))}`;
}
