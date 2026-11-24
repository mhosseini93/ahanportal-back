-- Product slugs are built once on create (name + CRM id, else code) and are locked afterwards
CREATE OR REPLACE FUNCTION products_slug_locked() RETURNS trigger AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'product slug is locked (product %)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER products_slug_locked BEFORE UPDATE OF slug ON products
  FOR EACH ROW EXECUTE FUNCTION products_slug_locked();
