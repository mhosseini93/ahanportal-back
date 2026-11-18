-- Attributes used by the old ahanonline catalog; keys match the import script
INSERT INTO "attributes" ("key", "name", "unit", "position") VALUES
  ('brand', 'برند', '', 1),
  ('size', 'سایز', '', 2),
  ('thickness', 'ضخامت', 'میلی‌متر', 3),
  ('standard', 'استاندارد', '', 4),
  ('state', 'حالت', '', 5),
  ('stock', 'محل تحویل', '', 6),
  ('sch', 'رده', '', 7),
  ('color', 'رنگ', '', 8),
  ('weight', 'وزن', 'کیلوگرم', 9),
  ('od', 'قطر خارجی', '', 10),
  ('color_code', 'کد رنگ', '', 11)
ON CONFLICT ("key") DO NOTHING;
