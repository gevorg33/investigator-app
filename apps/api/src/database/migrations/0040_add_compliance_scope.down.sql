-- Reverses 0040_add_compliance_scope, as far as PostgreSQL allows: an enum value cannot be removed.
-- Revoking the grants is what takes the scope away from people; the value stays, unused.
UPDATE user_staff_scopes SET revoked_at = now() WHERE scope = 'COMPLIANCE' AND revoked_at IS NULL;
