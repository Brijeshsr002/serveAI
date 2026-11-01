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

/** A Postgres DATE column holds UTC midnight of its calendar day, so no IST shift applies to these. */
export const dayKeyToDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
export const dateToDayKey = (d: Date) => d.toISOString().slice(0, 10);
export const addDayKey = (key: string, days: number) => dateToDayKey(addDays(dayKeyToDate(key), days));

export function isDayKey(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = dayKeyToDate(v);
  return !Number.isNaN(d.getTime()) && dateToDayKey(d) === v;
}

const formatDayKey = (key: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(dayKeyToDate(key));

/** "SUNDAY, NOVEMBER 1" */
export const dayHeading = (key: string) => formatDayKey(key, { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
/** "Sun, Nov 1" */
export const dayShort = (key: string) => formatDayKey(key, { weekday: "short", month: "short", day: "numeric" });
/** "November 2026" */
export const monthLabel = (month: string) => formatDayKey(`${month}-01`, { month: "long", year: "numeric" });

/** Last calendar day of a yyyy-mm month, as yyyy-mm-dd. */
export function lastDayOfMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return dateToDayKey(new Date(Date.UTC(y, m, 0)));
}

/** The instants an IST month covers: start inclusive, end exclusive. */
export function monthRangeIST(month: string) {
  const end = addDayKey(lastDayOfMonth(month), 1);
  return { start: new Date(`${month}-01T00:00:00+05:30`), end: new Date(`${end}T00:00:00+05:30`) };
}

/** "2 days 3 hrs", "3 hrs 20 min", "45 min" */
export function duration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const unit = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (days > 0) return hours ? `${unit(days, "day")} ${unit(hours, "hr")}` : unit(days, "day");
  if (hours > 0) return minutes % 60 ? `${unit(hours, "hr")} ${minutes % 60} min` : unit(hours, "hr");
  return `${minutes} min`;
}
