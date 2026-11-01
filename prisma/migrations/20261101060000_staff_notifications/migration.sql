-- In-app notifications for staff. The older "notifications" table is the customer WhatsApp log.
CREATE TABLE "staff_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_notifications_user_id_created_at_idx" ON "staff_notifications"("user_id", "created_at");

ALTER TABLE "staff_notifications" ADD CONSTRAINT "staff_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
