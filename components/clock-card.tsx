import { ActionButton } from "@/components/actions";
import { Card, CardContent } from "@/components/ui/card";
import { dayHeading } from "@/lib/format";
import { dayLabel, todayKey, todayState } from "@/lib/services/attendance";

/** The day and times come from the server; the button only says in or out. */
export async function ClockCard({ userId }: { userId: string }) {
  const row = await todayState(userId);
  const status = row?.status ?? "ABSENT";
  const action = status === "LEAVE" || row?.clockOutAt ? null : row?.clockInAt ? "out" : "in";
  const hint = status === "LEAVE" ? "Ask an admin if this is wrong." : row?.clockOutAt ? "Done for today." : null;
  return (
    <Card className="mb-5 border-l-4 border-l-primary">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground">{dayHeading(todayKey())}</p>
          <p className="mt-1 text-lg font-semibold">{dayLabel(status, row, true)}</p>
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        </div>
        {action && (
          <ActionButton
            label={action === "in" ? "Clock in" : "Clock out"}
            endpoint="/api/attendance/clock"
            body={{ action }}
            success={action === "in" ? "Clocked in" : "Clocked out"}
            size="lg"
            variant={action === "in" ? "default" : "outline"}
          />
        )}
      </CardContent>
    </Card>
  );
}
