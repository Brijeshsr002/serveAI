-- CreateTable
CREATE TABLE "staff_inactive_periods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "until_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_inactive_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_inactive_periods_user_id_idx" ON "staff_inactive_periods"("user_id");

-- At most one open period per person, so a repeated deactivation keeps the original start.
CREATE UNIQUE INDEX "staff_inactive_periods_one_open" ON "staff_inactive_periods" ("user_id") WHERE "until_date" IS NULL;

-- AddForeignKey
ALTER TABLE "staff_inactive_periods" ADD CONSTRAINT "staff_inactive_periods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The real deactivation dates are unknown, and no day before today can be derived as absent anyway.
INSERT INTO "staff_inactive_periods" ("id", "user_id", "from_date")
SELECT 'backfill_' || "id", "id", (now() AT TIME ZONE 'Asia/Kolkata')::date FROM "users" WHERE "active" = false;

-- The IST day attendance goes live. No earlier day is derived as absent.
INSERT INTO "settings" ("key", "value", "updated_at")
VALUES ('attendance_start', to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD'), CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
