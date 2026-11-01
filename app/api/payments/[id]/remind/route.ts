import { authed } from "@/lib/api/route";
import { PaymentService } from "@/lib/payments";
import { STAFF } from "@/lib/permissions";

// No body: the link and amount are always the payment's own.
export const POST = authed(STAFF, async ({ actor, params }) => PaymentService.sendReminder(actor, params.id));
