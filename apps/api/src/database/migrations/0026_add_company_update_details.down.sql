-- Reverses 0026_add_company_update_details: the grant, then the permission it names.
DELETE FROM role_permissions WHERE permission_key = 'company.update_details';--> statement-breakpoint
DELETE FROM permissions WHERE key = 'company.update_details';
