import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as clock } from "@/app/api/attendance/clock/route";
import { POST as mark } from "@/app/api/attendance/mark/route";
import { GET as teamRoute } from "@/app/api/attendance/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { GET as profileGet, PATCH as profilePatch } from "@/app/api/users/[id]/profile/route";
import { DELETE as userDelete, PATCH as userPatch } from "@/app/api/users/[id]/route";
import { GET as usersGet } from "@/app/api/users/route";
import { GET as workersGet } from "@/app/api/workers/route";
import { GET as activityGet } from "@/app/api/activity-logs/route";
import { GET as exportGet } from "@/app/api/reports/export/route";
import { SYSTEM_ACTOR } from "@/lib/activity";
import { db } from "@/lib/db";
import { dayKeyToDate, dateToDayKey, duration } from "@/lib/format";
import { clockIn, personMonthSummary, summarizeMonth, teamDay, teamMonthSummaries, recentDays, todayKey } from "@/lib/services/attendance";
import { SETTING_KEYS } from "@/lib/settings";
import { createJob } from "@/lib/services/jobs";
import { getOwnProfile, getStaffProfile, receptionPerformance, workerPerformance } from "@/lib/services/staff";
import { userSelect } from "@/lib/services/users";
import { call, loginCookie, makeCustomer, makeJob, makeUser, makeVehicle } from "./helpers";

const SECRET_NOTE = "SECRET-STAFF-NOTE";
const SALARY = "98765.43";

const freeze = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

afterEach(() => {
  vi.useRealTimers();
});

describe("attendance", () => {
  let admin: string, workerCookie: string, receptionCookie: string;
  let workerId: string, receptionId: string;

  beforeEach(async () => {
    admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const w = await makeUser("WORKER", "Raj");
    const r = await makeUser("RECEPTIONIST", "Rita");
    workerId = w.id;
    receptionId = r.id;
    workerCookie = await loginCookie(w.email);
    receptionCookie = await loginCookie(r.email);
  });

  // Sessions last 12 hours, so log in again once the clock has moved.
  const freezeAt = async (iso: string) => {
    freeze(iso);
    admin = await loginCookie("admin@test.local");
    workerCookie = await loginCookie("raj@test.local");
    receptionCookie = await loginCookie("rita@test.local");
  };

  const clockAs = (cookie: string, action: string) => call(clock, "POST", { cookie, body: { action } });
  const markAs = (cookie: string, body: Record<string, unknown>) => call(mark, "POST", { cookie, body });

  it("clocks in once and rejects a second clock-in without moving the time", async () => {
    const first = await clockAs(workerCookie, "in");
    expect(first.status).toBe(200);
    const second = await clockAs(workerCookie, "in");
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe("ALREADY_CLOCKED_IN");
    const rows = await db.attendance.findMany({ where: { userId: workerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].clockInAt!.toISOString()).toBe(first.json.data.clockInAt);
  });

  it("survives two clock-ins racing: one wins, one gets a conflict", async () => {
    const results = await Promise.all([clockAs(workerCookie, "in"), clockAs(workerCookie, "in")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.attendance.count({ where: { userId: workerId } })).toBe(1);
  });

  it("ignores any time or date the client sends", async () => {
    const res = await call(clock, "POST", { cookie: workerCookie, body: { action: "in", clockInAt: "2001-01-01T00:00:00Z", date: "2001-01-01", userId: receptionId } });
    expect(res.status).toBe(200);
    const row = await db.attendance.findFirstOrThrow({ where: { userId: workerId } });
    expect(row.clockInAt!.getFullYear()).not.toBe(2001);
    expect(dateToDayKey(row.date)).toBe(todayKey());
    expect(await db.attendance.count({ where: { userId: receptionId } })).toBe(0);
  });

  it("needs a clock-in before a clock-out, and only clocks out once", async () => {
    const early = await clockAs(workerCookie, "out");
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe("NOT_CLOCKED_IN");
    await clockAs(workerCookie, "in");
    const out = await clockAs(workerCookie, "out");
    expect(out.status).toBe(200);
    expect(out.json.data.clockOutAt).toBeTruthy();
    const again = await clockAs(workerCookie, "out");
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("ALREADY_CLOCKED_OUT");
    expect((await clockAs(workerCookie, "in")).status).toBe(409);
  });

  it("rejects an unknown clock action", async () => {
    expect((await clockAs(workerCookie, "lunch")).status).toBe(400);
  });

  it("lets reception and admins clock in too", async () => {
    expect((await clockAs(receptionCookie, "in")).status).toBe(200);
    expect((await clockAs(admin, "in")).status).toBe(200);
  });

  it("files a clock-in under the IST day across 18:30 UTC", async () => {
    await freezeAt("2026-11-01T18:29:00Z"); // 23:59 IST on Nov 1
    expect(todayKey()).toBe("2026-11-01");
    expect((await clockAs(workerCookie, "in")).status).toBe(200);
    expect((await clockAs(workerCookie, "out")).status).toBe(200);

    vi.setSystemTime(new Date("2026-11-01T18:31:00Z")); // 00:01 IST on Nov 2
    expect(todayKey()).toBe("2026-11-02");
    // A new day: no clock-in yet, and yesterday's row doesn't count.
    expect((await clockAs(workerCookie, "out")).status).toBe(409);
    expect((await clockAs(workerCookie, "in")).status).toBe(200);

    const rows = await db.attendance.findMany({ where: { userId: workerId }, orderBy: { date: "asc" } });
    expect(rows.map((r) => dateToDayKey(r.date))).toEqual(["2026-11-01", "2026-11-02"]);
    expect(rows[1].clockInAt!.toISOString()).toBe("2026-11-01T18:31:00.000Z");
  });

  it("leave blocks clock-in until an admin changes it", async () => {
    const today = todayKey();
    expect((await markAs(admin, { userId: workerId, date: today, action: "leave", note: "Family function" })).status).toBe(200);
    const blocked = await clockAs(workerCookie, "in");
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe("ON_LEAVE");
    expect((await clockAs(workerCookie, "out")).status).toBe(409);

    expect((await markAs(admin, { userId: workerId, date: today, action: "present" })).status).toBe(200);
    // The real arrival time fills in after an admin's mark.
    const res = await clockAs(workerCookie, "in");
    expect(res.status).toBe(200);
    expect(res.json.data.clockInAt).toBeTruthy();
    expect(res.json.data).not.toHaveProperty("note");
  });

  it("clearing leave lets someone clock in, and is logged", async () => {
    const today = todayKey();
    await markAs(admin, { userId: workerId, date: today, action: "leave" });
    expect((await markAs(admin, { userId: workerId, date: today, action: "clear" })).status).toBe(200);
    expect(await db.attendance.count({ where: { userId: workerId } })).toBe(0);
    expect((await clockAs(workerCookie, "in")).status).toBe(200);
    const logs = await db.activityLog.findMany({ where: { entityId: workerId, action: { startsWith: "ATTENDANCE_" } } });
    expect(logs.map((l) => l.action).sort()).toEqual(["ATTENDANCE_CLEARED", "ATTENDANCE_MARKED"]);
  });

  it("won't overwrite a recorded clock-in with leave", async () => {
    await clockAs(workerCookie, "in");
    const res = await markAs(admin, { userId: workerId, date: todayKey(), action: "leave" });
    expect(res.status).toBe(409);
    expect((await db.attendance.findFirstOrThrow({ where: { userId: workerId } })).status).toBe("PRESENT");
  });

  it("validates dates: leave may be future, present may not, garbage is refused", async () => {
    await freezeAt("2026-11-10T06:00:00Z");
    await db.user.updateMany({ data: { joinedOn: dayKeyToDate("2026-01-01") } });
    expect((await markAs(admin, { userId: workerId, date: "2026-11-20", action: "leave" })).status).toBe(200);
    expect((await markAs(admin, { userId: workerId, date: "2026-11-21", action: "present" })).status).toBe(400);
    expect((await markAs(admin, { userId: workerId, date: "2026-02-30", action: "leave" })).status).toBe(400);
    expect((await markAs(admin, { userId: workerId, date: "tomorrow", action: "leave" })).status).toBe(400);
    expect((await markAs(admin, { userId: workerId, date: "2028-01-01", action: "leave" })).status).toBe(400);
    expect((await markAs(admin, { userId: workerId, date: "2025-12-31", action: "leave" })).json.error.code).toBe("BEFORE_JOINING");
  });

  it("only marks workers and receptionists", async () => {
    const other = await makeUser("ADMIN", "Other");
    expect((await markAs(admin, { userId: other.id, date: todayKey(), action: "leave" })).status).toBe(404);
  });

  it("derives absent: no row means not clocked in, and nothing is stored", async () => {
    const inactive = await makeUser("WORKER", "Gone");
    await db.user.update({ where: { id: inactive.id }, data: { active: false } });
    await clockAs(receptionCookie, "in");
    const day = await teamDay();
    expect(day.entries.map((e) => e.name)).toEqual(["Raj", "Rita"]);
    expect(day).toMatchObject({ present: 1, leave: 0, absent: 1 });
    const raj = day.entries.find((e) => e.userId === workerId)!;
    expect(raj.status).toBe("ABSENT");
    expect(raj.label).toBe("Not clocked in");
    expect(await db.attendance.count({ where: { userId: workerId } })).toBe(0);
  });

  it("labels each state the way the card shows it", async () => {
    await freezeAt("2026-11-01T04:02:00Z"); // 9:32 am IST
    await db.user.updateMany({ data: { joinedOn: dayKeyToDate("2026-10-01") } });
    await clockAs(workerCookie, "in");
    let day = await teamDay();
    expect(day.entries.find((e) => e.userId === workerId)!.label).toBe("In at 9:32 am");
    vi.setSystemTime(new Date("2026-11-01T12:31:00Z")); // 6:01 pm IST
    await clockAs(workerCookie, "out");
    await markAs(admin, { userId: receptionId, date: "2026-11-01", action: "leave" });
    day = await teamDay();
    expect(day.entries.find((e) => e.userId === workerId)!.label).toBe("In 9:32 am · Out 6:01 pm");
    expect(day.entries.find((e) => e.userId === receptionId)!.label).toBe("On leave");

    const past = await teamDay("2026-10-15");
    expect(past.entries.every((e) => e.label === "Absent")).toBe(true);
    const future = await teamDay("2026-11-05");
    expect(future.absent).toBe(0);
    expect(future.entries.every((e) => e.status === "NONE")).toBe(true);
  });

  it("doesn't list someone on a day before they joined", async () => {
    await db.user.update({ where: { id: workerId }, data: { joinedOn: dayKeyToDate("2026-10-20") } });
    await db.user.update({ where: { id: receptionId }, data: { joinedOn: dayKeyToDate("2026-10-01") } });
    const day = await teamDay("2026-10-10");
    expect(day.entries.map((e) => e.userId)).toEqual([receptionId]);
  });

  describe("month summary", () => {
    const rows = (entries: [string, "PRESENT" | "LEAVE"][]) => entries.map(([d, status]) => ({ date: dayKeyToDate(d), status }));

    it("doesn't count future days", () => {
      const s = summarizeMonth("2026-11", { startKey: "2026-01-01", active: true }, rows([["2026-11-02", "PRESENT"], ["2026-11-20", "LEAVE"]]), "2026-11-05");
      expect(s).toMatchObject({ present: 1, leave: 0, absent: 3, daysSoFar: 5, todayPending: true, upcomingLeave: 1 });
    });

    it("doesn't call days before joining absent, but counts a real record on one", () => {
      const s = summarizeMonth("2026-11", { startKey: "2026-11-04", active: true }, rows([["2026-11-01", "PRESENT"], ["2026-11-04", "PRESENT"]]), "2026-11-06");
      expect(s).toMatchObject({ present: 2, absent: 1, daysSoFar: 4, todayPending: true });
    });

    it("counts a clock-in when the joined date is still to come", () => {
      const s = summarizeMonth("2026-11", { startKey: "2026-11-03", active: true }, rows([["2026-11-01", "PRESENT"]]), "2026-11-01");
      expect(s).toMatchObject({ present: 1, absent: 0, daysSoFar: 1, todayPending: false });
    });

    it("doesn't call inactive days absent", () => {
      const inactive = [{ from: "2026-09-01", until: "2026-10-11" }, { from: "2026-10-20", until: "2026-10-22" }];
      const s = summarizeMonth("2026-10", { startKey: "2026-01-01", active: true, inactive }, rows([["2026-10-05", "PRESENT"], ["2026-10-12", "PRESENT"]]), "2026-11-05");
      // 31 days, less Oct 1-10 and Oct 20-21, plus the record on Oct 5.
      expect(s).toMatchObject({ present: 2, absent: 18, daysSoFar: 20 });
      expect(summarizeMonth("2026-10", { startKey: "2026-01-01", active: true, inactive: [{ from: "2026-09-01", until: "2026-11-01" }] }, [], "2026-11-05")).toMatchObject({ absent: 0, daysSoFar: 0 });
    });

    it("counts a finished month in full", () => {
      const s = summarizeMonth("2026-10", { startKey: "2026-01-01", active: true }, rows([["2026-10-01", "PRESENT"], ["2026-10-02", "LEAVE"]]), "2026-11-05");
      expect(s).toMatchObject({ present: 1, leave: 1, absent: 29, daysSoFar: 31, todayPending: false });
    });

    it("gives zeros for someone who hasn't joined and for future months", () => {
      expect(summarizeMonth("2026-11", { startKey: "2026-12-01", active: true }, [], "2026-11-05")).toMatchObject({ absent: 0, daysSoFar: 0 });
      expect(summarizeMonth("2026-12", { startKey: "2026-01-01", active: true }, [], "2026-11-05")).toMatchObject({ absent: 0, daysSoFar: 0 });
    });

    it("doesn't derive absence for inactive staff", () => {
      expect(summarizeMonth("2026-10", { startKey: "2026-01-01", active: false }, [], "2026-11-05").absent).toBeNull();
    });

    it("counts a day with a record today, without treating it as pending", () => {
      const s = summarizeMonth("2026-11", { startKey: "2026-01-01", active: true }, rows([["2026-11-05", "PRESENT"]]), "2026-11-05");
      expect(s).toMatchObject({ present: 1, absent: 4, todayPending: false });
    });

    it("reads real rows for the team, using the join date", async () => {
      await freezeAt("2026-11-05T06:00:00Z");
      await db.user.update({ where: { id: workerId }, data: { joinedOn: dayKeyToDate("2026-11-03") } });
      await db.user.update({ where: { id: receptionId }, data: { joinedOn: dayKeyToDate("2026-10-01") } });
      await clockAs(workerCookie, "in");
      await markAs(admin, { userId: workerId, date: "2026-11-25", action: "leave" });
      const summaries = await teamMonthSummaries("2026-11");
      expect(summaries.find((s) => s.userId === workerId)!.summary).toMatchObject({ present: 1, leave: 0, absent: 2, daysSoFar: 3, upcomingLeave: 1 });
      expect(summaries.find((s) => s.userId === receptionId)!.summary).toMatchObject({ present: 0, absent: 4, daysSoFar: 5, todayPending: true });
    });

    it("lists recent days from joining onwards, newest first", async () => {
      freeze("2026-11-05T06:00:00Z");
      const days = await recentDays({ id: workerId, startKey: "2026-11-04", active: true });
      expect(days.map((d) => [d.date, d.label])).toEqual([["2026-11-05", "Not clocked in"], ["2026-11-04", "Absent"]]);
    });
  });

  describe("inactive staff", () => {
    const relogin = async (iso: string) => {
      freeze(iso);
      admin = await loginCookie("admin@test.local");
    };

    it("keeps a deactivated person's records on past days and months", async () => {
      freeze("2026-11-05T06:00:00Z");
      await db.user.updateMany({ data: { joinedOn: dayKeyToDate("2026-10-01") } });
      await db.attendance.create({ data: { userId: workerId, date: dayKeyToDate("2026-10-10"), status: "PRESENT" } });
      await db.user.update({ where: { id: workerId }, data: { active: false } });

      const day = await teamDay("2026-10-10");
      expect(day.entries.find((e) => e.userId === workerId)).toMatchObject({ status: "PRESENT", active: false });
      expect(day).toMatchObject({ present: 1, absent: 1 });
      // No record that day, and absence isn't derived for them.
      expect((await teamDay("2026-10-11")).entries.map((e) => e.userId)).toEqual([receptionId]);

      const october = await teamMonthSummaries("2026-10");
      expect(october.find((s) => s.userId === workerId)).toMatchObject({ active: false, summary: { present: 1, absent: null } });
      expect((await teamMonthSummaries("2026-09")).map((s) => s.userId)).toEqual([receptionId]);
    });

    it("doesn't call a deactivate and reactivate gap absent, whichever route made it", async () => {
      await db.user.updateMany({ data: { joinedOn: dayKeyToDate("2026-01-01") } });
      await relogin("2026-09-01T06:00:00Z");
      expect((await call(profilePatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { active: false } })).status).toBe(200);
      await relogin("2026-11-05T06:00:00Z");
      expect((await call(userPatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { active: true } })).status).toBe(200);

      const person = { id: workerId, startKey: "2026-01-01", active: true };
      expect((await teamDay("2026-10-15")).entries.map((e) => e.userId)).toEqual([receptionId]);
      expect((await teamDay("2026-08-15")).entries.find((e) => e.userId === workerId)!.status).toBe("ABSENT");
      expect((await teamMonthSummaries("2026-10")).find((s) => s.userId === workerId)!.summary).toMatchObject({ absent: 0, daysSoFar: 0 });
      expect(await personMonthSummary(person, "2026-11")).toMatchObject({ absent: 0, daysSoFar: 1, todayPending: true });
      expect((await personMonthSummary(person, "2026-08")).absent).toBe(31);
      expect((await recentDays(person)).map((d) => d.date)).toEqual(["2026-11-05"]);
    });

    it("keeps the first day of a spell when deactivated twice, and closes it once", async () => {
      await relogin("2026-09-01T06:00:00Z");
      expect((await call(userDelete, "DELETE", { cookie: admin, params: { id: workerId } })).status).toBe(200);
      await relogin("2026-09-10T06:00:00Z");
      expect((await call(userPatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { active: false } })).status).toBe(200);
      await relogin("2026-09-20T06:00:00Z");
      for (let i = 0; i < 2; i++) expect((await call(userPatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { active: true } })).status).toBe(200);
      const periods = await db.staffInactivePeriod.findMany({ where: { userId: workerId } });
      expect(periods.map((p) => [dateToDayKey(p.fromDate), dateToDayKey(p.untilDate!)])).toEqual([["2026-09-01", "2026-09-20"]]);
    });

    it("doesn't open a spell when a save leaves someone active", async () => {
      expect((await call(userPatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { name: "Raj K", active: true } })).status).toBe(200);
      expect(await db.staffInactivePeriod.count()).toBe(0);
    });
  });

  describe("records before the joined date", () => {
    it("reports a clock-in before joining the same on the card and the profile", async () => {
      await freezeAt("2026-11-01T06:00:00Z");
      await db.user.update({ where: { id: workerId }, data: { joinedOn: dayKeyToDate("2026-11-03") } });
      await clockIn(workerId);
      expect((await teamDay()).entries.find((e) => e.userId === workerId)!.status).toBe("PRESENT");
      const profile = (await getOwnProfile(workerId))!;
      expect(await personMonthSummary(profile)).toMatchObject({ present: 1, absent: 0, daysSoFar: 1, todayPending: false });
      expect((await recentDays(profile)).map((d) => d.status)).toEqual(["PRESENT"]);
    });

    it("keeps the records when the joined date moves past them", async () => {
      await freezeAt("2026-11-10T06:00:00Z");
      await db.attendance.create({ data: { userId: workerId, date: dayKeyToDate("2026-11-02"), status: "PRESENT" } });
      await db.user.update({ where: { id: workerId }, data: { joinedOn: dayKeyToDate("2026-11-09") } });
      expect((await teamMonthSummaries("2026-11")).find((s) => s.userId === workerId)!.summary).toMatchObject({ present: 1, absent: 1, daysSoFar: 3, todayPending: true });
    });
  });

  describe("attendance start day", () => {
    beforeEach(async () => {
      freeze("2026-11-05T06:00:00Z");
      admin = await loginCookie("admin@test.local");
      await db.setting.create({ data: { key: "attendance_start", value: "2026-11-01" } });
      // joinedOn is left empty, as the migration leaves it for existing staff.
      await db.user.updateMany({ data: { createdAt: new Date("2026-03-01T06:00:00Z"), joinedOn: null } });
    });

    it("derives no absence before it", async () => {
      expect((await teamDay("2026-10-15")).entries).toEqual([]);
      expect((await teamDay("2026-11-02")).absent).toBe(2);
      expect((await teamMonthSummaries("2026-10")).map((s) => s.summary)).toEqual([expect.objectContaining({ absent: 0, daysSoFar: 0 }), expect.objectContaining({ absent: 0, daysSoFar: 0 })]);
      expect((await teamMonthSummaries("2026-11"))[0].summary).toMatchObject({ absent: 4, daysSoFar: 5, todayPending: true });
      const profile = (await getOwnProfile(workerId))!;
      expect(profile.startKey).toBe("2026-11-01");
      expect((await recentDays(profile)).map((d) => d.date)).toEqual(["2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02", "2026-11-01"]);
    });

    it("still uses a later joined date", async () => {
      await db.user.update({ where: { id: workerId }, data: { joinedOn: dayKeyToDate("2026-11-04") } });
      expect((await getStaffProfile(workerId))!.startKey).toBe("2026-11-04");
    });

    it("still lets an admin record an earlier day, which then counts", async () => {
      await db.user.update({ where: { id: workerId }, data: { joinedOn: dayKeyToDate("2026-01-01") } });
      expect((await markAs(admin, { userId: workerId, date: "2026-10-15", action: "present" })).status).toBe(200);
      expect((await teamDay("2026-10-15")).entries.map((e) => e.userId)).toEqual([workerId]);
      expect((await teamMonthSummaries("2026-10")).find((s) => s.userId === workerId)!.summary).toMatchObject({ present: 1, absent: 0, daysSoFar: 1 });
    });

    it("can't be changed through the settings API", () => {
      expect(SETTING_KEYS).not.toContain("attendance_start");
    });
  });

  describe("permissions", () => {
    it("stops non-admins marking leave, for themselves or anyone else", async () => {
      for (const cookie of [workerCookie, receptionCookie]) {
        expect((await markAs(cookie, { userId: workerId, date: todayKey(), action: "leave" })).status).toBe(403);
        expect((await markAs(cookie, { userId: receptionId, date: todayKey(), action: "clear" })).status).toBe(403);
      }
      expect(await db.attendance.count()).toBe(0);
    });

    it("stops non-admins reading the team view or another person's profile", async () => {
      for (const cookie of [workerCookie, receptionCookie]) {
        expect((await call(teamRoute, "GET", { cookie, path: "/api/attendance" })).status).toBe(403);
        expect((await call(profileGet, "GET", { cookie, params: { id: workerId } })).status).toBe(403);
        expect((await call(profileGet, "GET", { cookie, params: { id: receptionId } })).status).toBe(403);
      }
      expect((await call(clock, "POST", { body: { action: "in" } })).status).toBe(401);
    });

    it("gives admins the team view, and refuses a bad date", async () => {
      const ok = await call(teamRoute, "GET", { cookie: admin, path: "/api/attendance" });
      expect(ok.status).toBe(200);
      expect(ok.json.data.entries).toHaveLength(2);
      expect((await call(teamRoute, "GET", { cookie: admin, path: "/api/attendance?date=nope" })).status).toBe(400);
    });
  });
});

describe("staff profiles", () => {
  let admin: string, workerCookie: string, receptionCookie: string;
  let workerId: string, receptionId: string;

  beforeEach(async () => {
    admin = await loginCookie((await makeUser("ADMIN", "Admin")).email);
    const w = await makeUser("WORKER", "Raj");
    const r = await makeUser("RECEPTIONIST", "Rita");
    workerId = w.id;
    receptionId = r.id;
    workerCookie = await loginCookie(w.email);
    receptionCookie = await loginCookie(r.email);
    await db.user.update({ where: { id: workerId }, data: { salary: SALARY, staffNotes: SECRET_NOTE, jobTitle: "Mechanic" } });
  });

  const hasSecrets = (value: unknown) => {
    const text = JSON.stringify(value);
    return text.includes(SECRET_NOTE) || text.includes(SALARY) || /salary|staffNotes/i.test(text);
  };

  it("keeps salary and notes out of userSelect", () => {
    expect(userSelect).not.toHaveProperty("salary");
    expect(userSelect).not.toHaveProperty("staffNotes");
  });

  it("doesn't return salary or notes from /api/users, even to an admin", async () => {
    const res = await call(usersGet, "GET", { cookie: admin, path: "/api/users" });
    expect(res.status).toBe(200);
    expect(res.json.data.length).toBeGreaterThan(0);
    expect(hasSecrets(res.json)).toBe(false);
    const patched = await call(userPatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { name: "Raj K" } });
    expect(patched.status).toBe(200);
    expect(hasSecrets(patched.json)).toBe(false);
  });

  it("doesn't return salary or notes from /api/workers or the session", async () => {
    for (const cookie of [admin, receptionCookie]) {
      const res = await call(workersGet, "GET", { cookie, path: "/api/workers" });
      expect(res.status).toBe(200);
      expect(hasSecrets(res.json)).toBe(false);
    }
    const me = await call(meRoute, "GET", { cookie: workerCookie });
    expect(me.json.data.id).toBe(workerId);
    expect(hasSecrets(me.json)).toBe(false);
  });

  it("doesn't put salary in the CSV exports", async () => {
    for (const type of ["services", "payments", "workers"]) {
      const res = await call(exportGet, "GET", { cookie: admin, path: `/api/reports/export?type=${type}` });
      expect(res.status).toBe(200);
      const text = await res.res.text();
      expect(text).not.toContain(SALARY);
      expect(text).not.toContain(SECRET_NOTE);
    }
  });

  it("a worker can't change their own salary, role or notes by any route", async () => {
    const body = { salary: 1, staffNotes: "hacked", jobTitle: "Boss", role: "ADMIN" };
    expect((await call(profilePatch, "PATCH", { cookie: workerCookie, params: { id: workerId }, body })).status).toBe(403);
    expect((await call(userPatch, "PATCH", { cookie: workerCookie, params: { id: workerId }, body })).status).toBe(403);
    const row = await db.user.findUniqueOrThrow({ where: { id: workerId } });
    expect(row.salary!.toFixed(2)).toBe(SALARY);
    expect(row.staffNotes).toBe(SECRET_NOTE);
    expect(row.role).toBe("WORKER");
    expect(row.jobTitle).toBe("Mechanic");
  });

  it("reception can't write or read profiles either", async () => {
    expect((await call(profilePatch, "PATCH", { cookie: receptionCookie, params: { id: workerId }, body: { salary: 1 } })).status).toBe(403);
    expect((await call(profileGet, "GET", { cookie: receptionCookie, params: { id: workerId } })).status).toBe(403);
  });

  it("the general admin PATCH ignores salary and notes", async () => {
    const res = await call(userPatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { salary: 5, staffNotes: "x", passwordHash: "x", name: "Raj K" } });
    expect(res.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: workerId } });
    expect(row.name).toBe("Raj K");
    expect(row.salary!.toFixed(2)).toBe(SALARY);
    expect(row.staffNotes).toBe(SECRET_NOTE);
    expect(row.passwordHash).not.toBe("x");
  });

  it("an admin edits everything in one form, and the log never holds the amount", async () => {
    const res = await call(profilePatch, "PATCH", {
      cookie: admin,
      params: { id: workerId },
      body: {
        name: "Raj Kumar", phone: "919000000999", email: "raj.k@test.local", jobTitle: "Senior mechanic", salary: "55555.50",
        joinedOn: "2026-02-03", address: "12 Main St", emergencyContact: "Kala 9000000000", staffNotes: "PRIVATE-NOTE", active: true,
      },
    });
    expect(res.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: workerId } });
    expect(row.salary!.toFixed(2)).toBe("55555.50");
    expect(dateToDayKey(row.joinedOn!)).toBe("2026-02-03");
    expect(row.staffNotes).toBe("PRIVATE-NOTE");
    expect(res.json.data.salary).toBe("55555.50");
    expect(res.json.data.joinedOn).toBe("2026-02-03");

    const log = await db.activityLog.findFirstOrThrow({ where: { action: "STAFF_PROFILE_UPDATED", entityId: workerId } });
    expect(log.summary).toContain("salary changed");
    expect((log.metadata as { fields: string[] }).fields).toContain("salary");
    const raw = JSON.stringify(log);
    for (const secret of ["55555", SALARY, "PRIVATE-NOTE", SECRET_NOTE]) expect(raw).not.toContain(secret);

    const api = await call(activityGet, "GET", { cookie: admin });
    expect(JSON.stringify(api.json)).not.toContain("55555");
  });

  it("logs only the fields that really changed", async () => {
    await call(profilePatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { salary: SALARY, jobTitle: "Lead" } });
    const log = await db.activityLog.findFirstOrThrow({ where: { action: "STAFF_PROFILE_UPDATED" } });
    expect((log.metadata as { fields: string[] }).fields).toEqual(["jobTitle"]);
    expect(log.summary).not.toContain("salary");
  });

  it("treats blanks as empty and partial saves as partial", async () => {
    const blank = await call(profilePatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { salary: "", joinedOn: "", phone: "" } });
    expect(blank.status).toBe(200);
    const row = await db.user.findUniqueOrThrow({ where: { id: workerId } });
    expect(row.salary).toBeNull();
    expect(row.joinedOn).toBeNull();
    expect(row.staffNotes).toBe(SECRET_NOTE); // not in the request, so untouched
    expect(row.jobTitle).toBe("Mechanic");
  });

  it("validates salary and joined date", async () => {
    for (const body of [{ salary: -1 }, { salary: "abc" }, { salary: "1.234" }, { salary: 99_999_999_999 }, { salary: true }, { joinedOn: "2026-13-01" }]) {
      expect((await call(profilePatch, "PATCH", { cookie: admin, params: { id: workerId }, body })).status).toBe(400);
    }
  });

  it("can't promote anyone or touch an admin through the profile route", async () => {
    await call(profilePatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { role: "ADMIN" } });
    expect((await db.user.findUniqueOrThrow({ where: { id: workerId } })).role).toBe("WORKER");
    const other = await makeUser("ADMIN", "Other");
    expect((await call(profilePatch, "PATCH", { cookie: admin, params: { id: other.id }, body: { name: "X" } })).status).toBe(404);
    expect((await call(profileGet, "GET", { cookie: admin, params: { id: other.id } })).status).toBe(404);
  });

  it("resets a password without logging it, and new sessions work", async () => {
    const newPassword = "BrandNewPass1!";
    const res = await call(profilePatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { password: newPassword } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).not.toContain(newPassword);
    await expect(loginCookie("raj@test.local", newPassword)).resolves.toContain("=");
    const log = await db.activityLog.findFirstOrThrow({ where: { action: "STAFF_PROFILE_UPDATED" } });
    expect(JSON.stringify(log)).not.toContain(newPassword);
    expect((log.metadata as { passwordChanged: boolean }).passwordChanged).toBe(true);
    expect((log.metadata as { fields: string[] }).fields).not.toContain("password");
  });

  it("won't deactivate someone with active jobs, same as the users route", async () => {
    const { job } = await makeJob();
    await db.serviceJob.update({ where: { id: job.id }, data: { assignedWorkerId: workerId, status: "ASSIGNED" } });
    const res = await call(profilePatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { active: false } });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("WORKER_HAS_ACTIVE_JOBS");
  });

  it("refuses a duplicate email", async () => {
    const res = await call(profilePatch, "PATCH", { cookie: admin, params: { id: workerId }, body: { email: "rita@test.local" } });
    expect(res.status).toBe(409);
  });

  it("a person's own view has their salary but never staffNotes", async () => {
    const own = await getOwnProfile(workerId);
    expect(own!.salary).toBe(SALARY);
    expect(own).not.toHaveProperty("staffNotes");
    expect(JSON.stringify(own)).not.toContain(SECRET_NOTE);
  });

  it("works out worker performance from a small fixture", async () => {
    freeze("2026-11-15T06:00:00Z");
    const customer = await makeCustomer();
    const vehicle = await makeVehicle(customer.id);
    const job = async (status: "COMPLETED" | "ASSIGNED", worker: string, createdAt: string, actualCompletion: string | null) => {
      const created = await createJob(SYSTEM_ACTOR, {
        customerId: customer.id, vehicleId: vehicle.id, serviceType: "Wash", customerComplaint: null, internalNotes: null,
        estimatedAmount: null, appointmentDate: null, expectedCompletion: null,
      });
      return db.serviceJob.update({
        where: { id: created.id },
        data: { status, assignedWorkerId: worker, createdAt: new Date(createdAt), actualCompletion: actualCompletion && new Date(actualCompletion) },
      });
    };
    const pay = (serviceJobId: string, amount: string, status: "PAID" | "PENDING" | "REFUNDED" = "PAID") =>
      db.payment.create({ data: { serviceJobId, customerId: customer.id, amount, paymentProvider: "razorpay", status } });

    const other = await makeUser("WORKER", "Kumar");
    const thisMonth = await job("COMPLETED", workerId, "2026-11-10T00:00:00Z", "2026-11-10T02:00:00Z"); // 2 hours
    const lastMonth = await job("COMPLETED", workerId, "2026-10-01T00:00:00Z", "2026-10-01T04:00:00Z"); // 4 hours
    // Nov 1 00:10 IST is still October in UTC, but November on the workshop's calendar.
    const boundary = await job("COMPLETED", workerId, "2026-10-31T12:40:00Z", "2026-10-31T18:40:00Z"); // 6 hours
    const noTime = await job("COMPLETED", workerId, "2026-11-01T00:00:00Z", null);
    const active = await job("ASSIGNED", workerId, "2026-11-14T00:00:00Z", null);
    const others = await job("COMPLETED", other.id, "2026-11-10T00:00:00Z", "2026-11-11T00:00:00Z");

    // 0.1 + 0.2 in floats would drift; paise don't.
    await pay(thisMonth.id, "0.10");
    await pay(lastMonth.id, "0.20");
    await pay(boundary.id, "1000.05");
    await pay(boundary.id, "500.00", "PENDING");
    await pay(noTime.id, "700.00", "REFUNDED");
    await pay(active.id, "900.00"); // paid, but the job isn't completed
    await pay(others.id, "5000.00");

    const p = await workerPerformance(workerId);
    expect(p.completedAllTime).toBe(4);
    expect(p.completedThisMonth).toBe(2); // thisMonth and boundary; noTime has no completion time
    expect(p.activeJobs).toBe(1);
    expect(p.timedJobs).toBe(3);
    expect(p.averageCompletionMs).toBe(4 * 3_600_000);
    expect(duration(p.averageCompletionMs!)).toBe("4 hrs");
    expect(p.revenue).toBe(1000.35);
    expect(p.recentJobs).toHaveLength(5);
    expect(p.recentJobs[0].id).toBe(active.id);
    expect(JSON.stringify(p)).not.toMatch(/rating|score/i);
  });

  it("has no average when no job has a completion time", async () => {
    const p = await workerPerformance(workerId);
    expect(p).toMatchObject({ completedAllTime: 0, averageCompletionMs: null, revenue: 0 });
  });

  it("counts the jobs a receptionist created, by IST month", async () => {
    freeze("2026-11-15T06:00:00Z");
    const { job } = await makeJob();
    const mk = (createdAt: string, createdById: string | null) =>
      db.serviceJob.create({
        data: {
          serviceNumber: `SRV-T-${createdAt}`, customerId: job.customerId, vehicleId: job.vehicleId, serviceType: "Wash",
          trackingToken: `t-${createdAt}`, createdById, createdAt: new Date(createdAt),
        },
      });
    await mk("2026-11-02T00:00:00Z", receptionId);
    await mk("2026-10-31T18:45:00Z", receptionId); // 00:15 IST on Nov 1
    await mk("2026-10-31T18:15:00Z", receptionId); // 23:45 IST on Oct 31
    await mk("2026-11-03T00:00:00Z", workerId);
    const p = await receptionPerformance(receptionId);
    expect(p.createdThisMonth).toBe(2);
    expect(p.createdAllTime).toBe(3);
    expect(p.recentJobs).toHaveLength(3);
  });
});
