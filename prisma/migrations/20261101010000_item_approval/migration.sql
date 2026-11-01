-- Extra work can wait for the customer's yes. Existing lines stay on the bill.
CREATE TYPE "ItemApproval" AS ENUM ('APPROVED', 'PENDING', 'DECLINED');
ALTER TABLE "service_items" ADD COLUMN "approval" "ItemApproval" NOT NULL DEFAULT 'APPROVED';
