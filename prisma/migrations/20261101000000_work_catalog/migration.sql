-- Ready-made work names. Existing rows, including ones an admin renamed or switched off, are left alone.
INSERT INTO "service_types" ("id", "name", "updated_at")
SELECT gen_random_uuid()::text, name, now()
FROM unnest(ARRAY[
  'General Service', 'Full Service', 'Oil Change', 'AC Service', 'Brake Service', 'Wheel Alignment', 'Wheel Balancing',
  'Car Wash', 'Foam Wash', 'Body Wash', 'Interior Cleaning', 'Polishing', 'Ceramic Coating', 'Denting and Painting',
  'Battery Replacement', 'Tyre Replacement', 'Engine Repair', 'Clutch Repair', 'Suspension Repair', 'Electrical Repair'
]) AS name
ON CONFLICT ("name") DO NOTHING;
