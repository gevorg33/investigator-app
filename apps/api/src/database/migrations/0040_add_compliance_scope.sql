-- The COMPLIANCE staff scope (T-035): placing and releasing legal holds. Its own migration because
-- PostgreSQL will not use an enum value in the transaction that added it.
ALTER TYPE "public"."staff_scope" ADD VALUE 'COMPLIANCE';
