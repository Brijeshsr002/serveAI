const TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

type Num = number | string | { toString(): string } | null | undefined;

export const toNumber = (v: Num) => (v === null || v === undefined ? 0 : Number(v.toString()));

export function money(v: Num) {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
    toNumber(v),
  );
}

/** Integer rupee text without the symbol for WhatsApp text ("₹4,850"). */
export const rupees = (v: Num) => `₹${new Intl.NumberFormat("en-IN").format(toNumber(v))}`;

export function dateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(d));
}

export function date(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: TZ }).format(new Date(d));
}

export function time(d: Date | string) {
  return new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: TZ }).format(new Date(d));
}

/** Start of the given day in IST, as a UTC instant. The workshop's "today" is an IST day. */
export function startOfDayIST(d = new Date()) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/** yyyy-mm-dd of an instant as seen in IST. */
export const istDayKey = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
export const istMonthKey = (d: Date) => istDayKey(d).slice(0, 7);
