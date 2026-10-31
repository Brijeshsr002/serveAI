import { badRequest } from "@/lib/errors";

/**
 * Canonical form is Sendiee's: full international digits, no "+" (919876543210).
 * Every phone entering the system passes through here, which is what keeps customers.phone unique.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  const cc = process.env.DEFAULT_COUNTRY_CODE ?? "91";
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = cc + digits.slice(1);
  else if (digits.length === 10) digits = cc + digits;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export function requirePhone(input: string): string {
  const phone = normalizePhone(input);
  if (!phone) throw badRequest("INVALID_PHONE", "Enter a valid phone number");
  return phone;
}

/** TN 38 AB-1234 -> TN38AB1234 */
export const normalizeRegistration = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, "");
