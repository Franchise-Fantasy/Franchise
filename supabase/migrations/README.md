# Database Migrations

## Generating the baseline migration

The `supabase db dump` command requires Docker Desktop. To create the baseline:

1. Install and start Docker Desktop
2. Run: `npx supabase db dump -f supabase/migrations/00000000000000_baseline.sql`

Alternatively, export from the Supabase Dashboard SQL Editor:
1. Go to https://supabase.com/dashboard/project/iuqbossmnsezzgocpcbo/sql
2. Run: `pg_dump --schema=public --no-owner --no-privileges`
3. Save the output as `00000000000000_baseline.sql` in this directory

## Creating new migrations

After the baseline is in place:
```
npx supabase migration new <migration_name>
```
This creates a timestamped `.sql` file. Write your DDL changes there, then apply with:
```
npx supabase db push
```
