-- At most one open payment per job, so a double-click cannot produce two live payment links.
CREATE UNIQUE INDEX "payments_one_open_per_job" ON "payments" ("service_job_id") WHERE status IN ('PENDING', 'PROCESSING');
