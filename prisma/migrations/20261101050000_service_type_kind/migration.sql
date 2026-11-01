-- Parts share the service rate approval flow. A part is only ever priced for the bill: it isn't offered as a job's service type.
CREATE TYPE "ServiceTypeKind" AS ENUM ('SERVICE', 'PART');

ALTER TABLE "service_types"
  ADD COLUMN "kind" "ServiceTypeKind" NOT NULL DEFAULT 'SERVICE',
  ADD COLUMN "proposed_by_id" TEXT;

CREATE INDEX "service_types_kind_active_idx" ON "service_types"("kind", "active");

ALTER TABLE "service_types" ADD CONSTRAINT "service_types_proposed_by_id_fkey" FOREIGN KEY ("proposed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Common parts from lib/work-catalog.ts, with their draft prices where the price list has one. An existing row with the same name is left alone.
INSERT INTO "service_types" ("id", "name", "kind", "rate", "updated_at") VALUES
  ('part_engine_oil', 'Engine Oil', 'PART', 800, CURRENT_TIMESTAMP),
  ('part_oil_filter', 'Oil Filter', 'PART', 300, CURRENT_TIMESTAMP),
  ('part_air_filter', 'Air Filter', 'PART', 500, CURRENT_TIMESTAMP),
  ('part_fuel_filter', 'Fuel Filter', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_cabin_ac_filter', 'Cabin AC Filter', 'PART', 600, CURRENT_TIMESTAMP),
  ('part_spark_plug', 'Spark Plug', 'PART', 300, CURRENT_TIMESTAMP),
  ('part_brake_pads', 'Brake Pads', 'PART', 2000, CURRENT_TIMESTAMP),
  ('part_brake_shoes', 'Brake Shoes', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_brake_disc', 'Brake Disc', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_brake_fluid', 'Brake Fluid', 'PART', 400, CURRENT_TIMESTAMP),
  ('part_coolant', 'Coolant', 'PART', 500, CURRENT_TIMESTAMP),
  ('part_battery', 'Battery', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_tyre', 'Tyre', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_wiper_blades', 'Wiper Blades', 'PART', 600, CURRENT_TIMESTAMP),
  ('part_clutch_plate', 'Clutch Plate', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_clutch_cable', 'Clutch Cable', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_timing_belt', 'Timing Belt', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_fan_belt', 'Fan Belt', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_radiator', 'Radiator', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_headlight_bulb', 'Headlight Bulb', 'PART', 400, CURRENT_TIMESTAMP),
  ('part_tail_light_bulb', 'Tail Light Bulb', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_shock_absorber', 'Shock Absorber', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_wheel_bearing', 'Wheel Bearing', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_ac_gas', 'AC Gas', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_horn', 'Horn', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_side_mirror', 'Side Mirror', 'PART', NULL, CURRENT_TIMESTAMP),
  ('part_fuse', 'Fuse', 'PART', NULL, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
