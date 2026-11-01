-- Default prices per service, with changes from staff waiting for an admin. The starting rates are a first draft to edit.
ALTER TABLE "service_types"
  ADD COLUMN "rate" DECIMAL(12,2),
  ADD COLUMN "proposed_rate" DECIMAL(12,2),
  ADD COLUMN "proposed_by" TEXT,
  ADD COLUMN "proposed_at" TIMESTAMP(3);

UPDATE "service_types" AS t SET "rate" = v.rate
FROM (VALUES
  ('General Service', 3000), ('Full Service', 6000), ('Oil Change', 1500), ('AC Service', 2000), ('Brake Service', 1500),
  ('Wheel Alignment', 800), ('Wheel Balancing', 500), ('Car Wash', 300), ('Foam Wash', 500), ('Body Wash', 300),
  ('Interior Cleaning', 800), ('Polishing', 1500), ('Ceramic Coating', 15000)
) AS v(name, rate)
WHERE t."name" = v.name;
