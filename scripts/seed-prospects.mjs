/**
 * Seed top 5 2026 NBA draft prospects into Contentful + Supabase.
 *
 * Usage: node --env-file=.env.local scripts/seed-prospects.mjs
 */

import { createClient as createCMAClient } from 'contentful-management';
import { createClient } from '@supabase/supabase-js';

const CMA_TOKEN = process.env.CONTFENFUL_MANAGEMENT_TOKEN;
const SPACE_ID = process.env.EXPO_PUBLIC_CONTENTFUL_SPACE_ID;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SB_PUBLISHABLE_KEY;

if (!CMA_TOKEN || !SPACE_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing env vars. Run with: node --env-file=.env.local scripts/seed-prospects.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PROSPECTS = [
  {
    name: 'Darryn Peterson',
    position: 'SG',
    school: 'Kansas',
    classYear: 'Freshman',
    projectedDraftYear: '2026',
    height: '6\'5"',
    weight: '195 lbs',
    dynastyValueScore: 95,
    recruitingRank: 1,
    projectedTeam1: 'Wizards',
    projectedTeam1Odds: '24%',
    projectedTeam2: 'Hornets',
    projectedTeam2Odds: '18%',
    projectedTeam3: 'Nets',
    projectedTeam3Odds: '14%',
  },
  {
    name: 'AJ Dybantsa',
    position: 'SF',
    school: 'BYU',
    classYear: 'Freshman',
    projectedDraftYear: '2026',
    height: '6\'9"',
    weight: '210 lbs',
    dynastyValueScore: 93,
    recruitingRank: 2,
    projectedTeam1: 'Hornets',
    projectedTeam1Odds: '22%',
    projectedTeam2: 'Wizards',
    projectedTeam2Odds: '18%',
    projectedTeam3: 'Jazz',
    projectedTeam3Odds: '12%',
  },
  {
    name: 'Cameron Boozer',
    position: 'PF',
    school: 'Duke',
    classYear: 'Freshman',
    projectedDraftYear: '2026',
    height: '6\'9"',
    weight: '250 lbs',
    dynastyValueScore: 91,
    recruitingRank: 3,
    projectedTeam1: 'Nets',
    projectedTeam1Odds: '20%',
    projectedTeam2: 'Raptors',
    projectedTeam2Odds: '16%',
    projectedTeam3: 'Blazers',
    projectedTeam3Odds: '12%',
  },
  {
    name: 'Caleb Wilson',
    position: 'PF',
    school: 'North Carolina',
    classYear: 'Freshman',
    projectedDraftYear: '2026',
    height: '6\'10"',
    weight: '215 lbs',
    dynastyValueScore: 87,
    recruitingRank: 7,
    projectedTeam1: 'Jazz',
    projectedTeam1Odds: '18%',
    projectedTeam2: 'Blazers',
    projectedTeam2Odds: '14%',
    projectedTeam3: 'Pistons',
    projectedTeam3Odds: '10%',
  },
  {
    name: 'Kingston Flemings',
    position: 'PG',
    school: 'Houston',
    classYear: 'Freshman',
    projectedDraftYear: '2026',
    height: '6\'4"',
    weight: '190 lbs',
    dynastyValueScore: 85,
    recruitingRank: 10,
    projectedTeam1: 'Raptors',
    projectedTeam1Odds: '16%',
    projectedTeam2: 'Pistons',
    projectedTeam2Odds: '14%',
    projectedTeam3: 'Spurs',
    projectedTeam3Odds: '10%',
  },
];

async function main() {
  // ── Contentful ──
  const cma = createCMAClient({ accessToken: CMA_TOKEN });

  console.log('Creating Contentful entries...');

  const entries = [];
  for (const p of PROSPECTS) {
    const fields = {};
    for (const [key, val] of Object.entries(p)) {
      fields[key] = { 'en-US': val };
    }
    fields.sport = { 'en-US': 'NBA' };
    fields.lastUpdated = { 'en-US': new Date().toISOString().split('T')[0] };

    const entry = await cma.entry.create(
      { spaceId: SPACE_ID, environmentId: 'master', contentTypeId: 'prospect' },
      { fields },
    );
    await cma.entry.publish(
      { spaceId: SPACE_ID, environmentId: 'master', entryId: entry.sys.id },
      { sys: { version: entry.sys.version } },
    );
    console.log(`  ✓ ${p.name} → ${entry.sys.id}`);
    entries.push({ ...p, contentfulEntryId: entry.sys.id });
  }

  // ── Supabase players rows ──
  console.log('\nCreating Supabase player rows...');

  for (const p of entries) {
    const { data, error } = await supabase
      .from('players')
      .insert({
        name: p.name,
        position: p.position,
        status: 'prospect',
        is_prospect: true,
        school: p.school,
        dynasty_value_score: p.dynastyValueScore,
        contentful_entry_id: p.contentfulEntryId,
      })
      .select('id')
      .single();

    if (error) {
      console.error(`  ✗ ${p.name}: ${error.message}`);
    } else {
      console.log(`  ✓ ${p.name} → ${data.id}`);
    }
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
