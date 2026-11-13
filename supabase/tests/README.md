# Database security test

Runs `schema.sql` against a plain local Postgres (with a small stand-in for Supabase's `auth` and `storage` schemas) and checks every access rule as a customer, a second customer, staff, and not-logged-in crew.

```sh
psql -f supabase/tests/stub_supabase.sql                 # creates database tophat_test
psql -d tophat_test -f supabase/schema.sql
psql -f supabase/tests/security_test.sql                 # ends with "ALL CHECKS PASSED"
```
