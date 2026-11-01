-- The starting prices from 20261101020000_service_rates went straight into the live rate, so customers were quoted them unreviewed.
-- Any still at its draft amount, and never set or approved by an admin, now waits in the admin's approval queue instead.
-- A request already waiting from staff is kept. Rates an admin has set or approved are left alone.
UPDATE "service_types" AS t
SET "proposed_rate" = COALESCE(t."proposed_rate", t."rate"),
    "proposed_by" = CASE WHEN t."proposed_rate" IS NULL THEN 'Starting price' ELSE t."proposed_by" END,
    "proposed_at" = CASE WHEN t."proposed_rate" IS NULL THEN CURRENT_TIMESTAMP ELSE t."proposed_at" END,
    "rate" = NULL
FROM (VALUES
  ('General Service', 3000), ('Full Service', 6000), ('Oil Change', 1500), ('AC Service', 2000), ('Brake Service', 1500),
  ('Wheel Alignment', 800), ('Wheel Balancing', 500), ('Car Wash', 300), ('Foam Wash', 500), ('Body Wash', 300),
  ('Interior Cleaning', 800), ('Polishing', 1500), ('Ceramic Coating', 15000)
) AS v(name, rate)
WHERE t."name" = v.name
  AND t."kind" = 'SERVICE'
  AND t."rate" = v.rate
  AND NOT EXISTS (
    SELECT 1 FROM "activity_logs" AS l
    WHERE l."entity_type" = 'ServiceType' AND l."entity_id" = t."id" AND l."action" IN ('SERVICE_RATE_UPDATED', 'SERVICE_RATE_APPROVED')
  );
