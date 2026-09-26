-- T-150: who may change an agency's core details — name, country, business email, time zone and
-- currency. `company.update` is held by OWNER and ADMIN and keeps the public profile, settings and
-- branding; these five are who the agency is to customers and to the platform, and change with
-- the OWNER only (owner decision, 2026-09-26; tenancy.md §3, which `tenants.spec.ts` parses).
--
-- Catalog data only: one permission and one grant, to the system OWNER role.

INSERT INTO permissions (key, description) VALUES
  ('company.update_details', 'Change the agency''s name, country, business email, time zone and currency');--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, 'company.update_details'
  FROM roles r
 WHERE r.key = 'OWNER' AND r.tenant_id IS NULL;
