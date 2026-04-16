/**
 * Seed a demo account for Apple TestFlight beta review.
 *
 * Creates:
 *  - 6 auth users (1 demo + 5 bots) with throwaway @franchisefantasy.co emails
 *  - 1 H2H 9-cat league ("Demo Dynasty")
 *  - Rosters, completed draft, 2-week schedule, matchups
 *  - Waiver priority, a pending trade offer to the demo user, a league chat welcome msg
 *
 * Usage: node --env-file=.env.local scripts/seed-demo-account.mjs
 *
 * Idempotent: if demo@franchisefantasy.co already exists, the script deletes the
 * existing user + any owned leagues and re-seeds from scratch.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SB_SECRET_KEY = process.env.SB_SECRET_KEY;

if (!SUPABASE_URL || !SB_SECRET_KEY) {
  console.error('Missing env vars. Run with: node --env-file=.env.local scripts/seed-demo-account.mjs');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SB_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEMO_EMAIL = 'demo@franchisefantasy.co';
const DEMO_PASSWORD = 'DemoPass2026!';

const USERS = [
  { key: 'demo',   email: DEMO_EMAIL,                         name: 'Team Demo',    tricode: 'DMO', commish: true  },
  { key: 'bot1',   email: 'bot1@franchisefantasy.co',         name: 'Rim Rattlers', tricode: 'RIM', commish: false },
  { key: 'bot2',   email: 'bot2@franchisefantasy.co',         name: 'Triple Dubs',  tricode: 'TRP', commish: false },
  { key: 'bot3',   email: 'bot3@franchisefantasy.co',         name: 'Swish Kings',  tricode: 'SWK', commish: false },
  { key: 'bot4',   email: 'bot4@franchisefantasy.co',         name: 'Glass Eaters', tricode: 'GLS', commish: false },
  { key: 'bot5',   email: 'bot5@franchisefantasy.co',         name: 'Court Vision', tricode: 'CVN', commish: false },
];

// Snake draft: 6 teams x 13 rounds = 78 picks. Mirrors seed_cat_league.sql.
// Each element: [round, teamIndex (0-5), player_id]
// Order follows snake: rd1 L->R, rd2 R->L, rd3 L->R, ...
const DRAFT_PICKS = [
  // Rd 1
  [1, 0, 'd50eaf07-b314-4e0f-be90-90f618e1cd08'], // SGA
  [1, 1, 'f7909beb-3309-4b4d-a2eb-d3218d42988c'], // KD
  [1, 2, 'e4de86d0-cd56-4810-b2e2-4d41b835d790'], // Mitchell
  [1, 3, 'aa17549f-2ddf-492c-b1bb-427a5dbec678'], // Maxey
  [1, 4, '6f21e902-f378-4a25-a2ab-15c8bc3f2c19'], // Brunson
  [1, 5, 'bb2764ff-7d0d-48a2-88be-4146d47800a1'], // J.Murray
  // Rd 2
  [2, 5, '9ca0d830-ae6c-4561-87f6-226124a6e74a'], // Kawhi
  [2, 4, '53ba47f0-7121-4740-af77-6ade8ba807af'], // Jokic
  [2, 3, '14914116-c9cf-4b32-9590-fb9b112378f5'], // Randle
  [2, 2, '8e2d5184-9b01-49a3-81f1-304816e56211'], // Bane
  [2, 1, '74900e13-e57c-4ceb-8151-74696055047f'], // Booker
  [2, 0, '2da678ce-5e57-4791-9426-a8c94aa51bf2'], // J.Johnson
  // Rd 3
  [3, 0, '0ba2aa96-e358-4a65-a1ee-c26eeea61d64'], // NAW
  [3, 1, '1051c5c6-2682-4a7a-a0a1-2c8aa80213d4'], // Banchero
  [3, 2, '88430c45-914d-44f1-95cc-8fade3de4c5b'], // Siakam
  [3, 3, '7413ffb9-f05e-4687-b79a-a20678282f04'], // Avdija
  [3, 4, '473e53cc-c6e5-410a-9ce0-ca1727c789a4'], // Wembanyama
  [3, 5, 'ef872c6e-270f-4b5f-a34d-73edb21cb4d0'], // Knueppel
  // Rd 4
  [4, 5, '1e1f0e9a-76c4-4907-a0cd-ec7ce266f50d'], // KAT
  [4, 4, 'a4f7fea7-5e8d-4572-b892-7970049c8931'], // LeBron
  [4, 3, '2572f534-e2ce-4dd4-a460-7e752bf83144'], // Sengun
  [4, 2, 'd940f3c6-57f7-44a8-b765-bcdc7d6cfc9a'], // Scottie Barnes
  [4, 1, 'eeaab802-8c13-47ed-a6cb-bfa8f4e69d8e'], // Fox
  [4, 0, 'd53ed4c0-a34e-409e-bb3c-a35d7cb0e63c'], // Bam
  // Rd 5
  [5, 0, 'cebdb6e2-00d2-4519-b072-97301601f07f'], // Harden
  [5, 1, '08a8c467-c601-4eb6-bbb3-a4558f0806c5'], // Amen Thompson
  [5, 2, '8757cb88-2ea3-430e-8b82-260dcd14a1e6'], // Cooper Flagg
  [5, 3, '937346b1-0e32-47f4-9448-1a9629d6a224'], // LaMelo
  [5, 4, 'd6dcf1ba-3918-4f14-924c-01aa2d35be6c'], // CJ McCollum
  [5, 5, 'b2e4fd7c-4d83-4a54-8aca-54a71f2e7269'], // Pritchard
  // Rd 6
  [6, 5, '4b51e55d-1eed-48b8-a0cb-4849d23c6d72'], // Zion
  [6, 4, '3a3356cd-0447-4b90-8a9f-53c776e92d42'], // Buzelis
  [6, 3, 'fcf22216-9800-47dd-abb1-04de5fab4595'], // Miles Bridges
  [6, 2, '823a869d-05e1-4e7b-9216-f107eb76b4ac'], // Mobley
  [6, 1, '8b9c386c-07d8-40df-aa6d-704a97f07d51'], // Saddiq Bey
  [6, 0, '3f1bd00f-e817-4639-b6bf-1b6e73997393'], // Brandon Miller
  // Rd 7
  [7, 0, 'd3dcc1e9-8171-4fa9-980b-96de346397c6'], // Reaves
  [7, 1, 'c30ddb38-ab64-4384-82ea-d5bcc9f5fdaf'], // Coby White
  [7, 2, '69843219-f388-4e77-bc91-7a8856193168'], // Jabari Smith Jr
  [7, 3, '083b1c9d-66f5-4012-9491-79247ad6e8a5'], // Chet
  [7, 4, 'c9c13181-33d4-4637-99fa-7c94676dd38d'], // VJ Edgecombe
  [7, 5, 'cdac1109-0e34-4f07-b9e3-7f70c12fcea6'], // Mikal Bridges
  // Rd 8
  [8, 5, 'd835346b-9432-4929-bff3-4a6843c182d7'], // OG
  [8, 4, 'd6b9ede0-685a-4133-9287-6382ea0d37c1'], // DaQuan Jeffries
  [8, 3, '04c2d06e-5e48-446b-b111-41d454d6d3ca'], // Herro
  [8, 2, '8a5818d6-2f1b-4932-8720-72f89701acfc'], // Giddey
  [8, 1, 'bcc1831c-a5de-49bf-a443-2ad9350112ad'], // Castle
  [8, 0, '13c73820-679b-480b-8902-4200c3bdcea5'], // Hardaway Jr
  // Rd 9
  [9, 0, '30ca15c1-2610-4c83-894b-e07d6fbf73be'], // Scoot
  [9, 1, '55a5939c-ec04-4405-834a-17d76f77be96'], // Reed Sheppard
  [9, 2, '8e206e68-2647-4436-b52d-d460d166189f'], // Podziemski
  [9, 3, '272cbe6a-b50b-46a4-974a-0613c9c1a072'], // Porzingis
  [9, 4, '534e97d5-a4fe-4d46-a763-8a8c43fe0710'], // Nembhard
  [9, 5, '6136e3c8-5839-445d-99fe-1c8d845fa58e'], // Camara
  // Rd 10
  [10, 5, '1d345181-52ff-4800-b579-0203e3c3542c'], // Fears
  [10, 4, 'cefb61ec-8561-4c58-9ae8-76b3d84d3d45'], // Gillespie
  [10, 3, '7b3fda82-8074-4bfa-a955-a9a02423e4f0'], // Keldon Johnson
  [10, 2, 'e944234a-1e6b-438c-b104-aae33c0929d1'], // RJ Barrett
  [10, 1, '94db0ea3-cb9c-4b19-af49-cef13ef37d2b'], // Grimes
  [10, 0, '3f0cef11-4dee-40f6-b4ef-1fee73ae139b'], // Cam Thomas
  // Rd 11
  [11, 0, 'd7204405-ebc7-4355-9ff3-7ef368926088'], // DiVincenzo
  [11, 1, 'bc96442e-a114-4e61-aaf3-322535cbfe53'], // Tre Jones
  [11, 2, 'a604bb9c-a6a4-4a3f-958e-df95ba58df27'], // Ace Bailey
  [11, 3, 'a3d95b31-265f-4d56-bb42-6bcfceb31f8b'], // Max Christie
  [11, 4, '1ff3b745-48c7-40f4-a7e2-948dd2a12d95'], // Sexton
  [11, 5, '164e0b6a-9dc6-4b43-895c-f2a379d849aa'], // Clingan
  // Rd 12
  [12, 5, '75362e39-db7f-4192-98bc-b8fd0fb687ed'], // Ajay Mitchell
  [12, 4, 'd37c0741-0bad-452b-bd45-6602e4d9dda5'], // John Collins
  [12, 3, '56e25e4c-d17a-4fe5-a59d-89fc068613aa'], // Dejounte
  [12, 2, '3895adb2-6144-4da5-b529-b7547f2fe85c'], // Derik Queen
  [12, 1, 'd244d4b3-2b6e-4596-a405-84f519e4e1f8'], // Grayson Allen
  [12, 0, '76d23f1c-1e96-43b3-a52d-7552d2cfcfcb'], // Vassell
  // Rd 13
  [13, 0, '6aa881a4-01a8-4c0c-b720-4a84ae73ddb7'], // WCJ
  [13, 1, '50f0f699-6e29-474b-8511-5205ad373e10'], // Alondes Williams
  [13, 2, 'c13c19c5-d17f-438b-b379-67cb21fa4f43'], // Ayton
  [13, 3, '7c6ad340-09c8-4e21-8c14-d7a3d2342f75'], // Champagnie
  [13, 4, 'dad6b424-5835-432e-a01c-570529e21a5a'], // Claxton
  [13, 5, 'aa5f4fc9-1aef-4ea9-96b4-ba99d9b17b8c'], // Mamukelashvili
];

// Per-team rosters: [player_id, eligible_positions, roster_slot]
// Roster slots: PG, SG, SF, PF, C, G, F, UTIL, UTIL, UTIL, BE, BE, BE
const ROSTERS = {
  0: [ // Team Demo (was Spoels)
    ['d50eaf07-b314-4e0f-be90-90f618e1cd08', 'PG',       'PG'],
    ['13c73820-679b-480b-8902-4200c3bdcea5', 'SG',       'SG'],
    ['0ba2aa96-e358-4a65-a1ee-c26eeea61d64', 'SF-SG',    'SF'],
    ['2da678ce-5e57-4791-9426-a8c94aa51bf2', 'PF-SF',    'PF'],
    ['d53ed4c0-a34e-409e-bb3c-a35d7cb0e63c', 'C-PF',     'C'],
    ['cebdb6e2-00d2-4519-b072-97301601f07f', 'PG-SG',    'G'],
    ['3f1bd00f-e817-4639-b6bf-1b6e73997393', 'SF-SG',    'F'],
    ['d3dcc1e9-8171-4fa9-980b-96de346397c6', 'PG-SF-SG', 'UTIL'],
    ['3f0cef11-4dee-40f6-b4ef-1fee73ae139b', 'SG',       'UTIL'],
    ['30ca15c1-2610-4c83-894b-e07d6fbf73be', 'PG',       'UTIL'],
    ['d7204405-ebc7-4355-9ff3-7ef368926088', 'PG-SF-SG', 'BE'],
    ['76d23f1c-1e96-43b3-a52d-7552d2cfcfcb', 'SF-SG',    'BE'],
    ['6aa881a4-01a8-4c0c-b720-4a84ae73ddb7', 'C',        'BE'],
  ],
  1: [ // Rim Rattlers (was Noah)
    ['eeaab802-8c13-47ed-a6cb-bfa8f4e69d8e', 'PG',       'PG'],
    ['74900e13-e57c-4ceb-8151-74696055047f', 'PG-SG',    'SG'],
    ['f7909beb-3309-4b4d-a2eb-d3218d42988c', 'PF-SF',    'SF'],
    ['1051c5c6-2682-4a7a-a0a1-2c8aa80213d4', 'PF-SF',    'PF'],
    ['8b9c386c-07d8-40df-aa6d-704a97f07d51', 'PF-SF',    'C'],
    ['08a8c467-c601-4eb6-bbb3-a4558f0806c5', 'PG-SF-SG', 'G'],
    ['d244d4b3-2b6e-4596-a405-84f519e4e1f8', 'SF-SG',    'F'],
    ['c30ddb38-ab64-4384-82ea-d5bcc9f5fdaf', 'PG-SG',    'UTIL'],
    ['bcc1831c-a5de-49bf-a443-2ad9350112ad', 'PG-SG',    'UTIL'],
    ['55a5939c-ec04-4405-834a-17d76f77be96', 'PG-SG',    'UTIL'],
    ['94db0ea3-cb9c-4b19-af49-cef13ef37d2b', 'PG-SG',    'BE'],
    ['bc96442e-a114-4e61-aaf3-322535cbfe53', 'PG-SF-SG', 'BE'],
    ['50f0f699-6e29-474b-8511-5205ad373e10', 'PG-SG',    'BE'],
  ],
  2: [ // Triple Dubs (was Goldman)
    ['e4de86d0-cd56-4810-b2e2-4d41b835d790', 'PG-SG',    'PG'],
    ['8e2d5184-9b01-49a3-81f1-304816e56211', 'PG-SF-SG', 'SG'],
    ['8757cb88-2ea3-430e-8b82-260dcd14a1e6', 'PG-SF-PF', 'SF'],
    ['88430c45-914d-44f1-95cc-8fade3de4c5b', 'PF-SF',    'PF'],
    ['823a869d-05e1-4e7b-9216-f107eb76b4ac', 'C-PF',     'C'],
    ['8a5818d6-2f1b-4932-8720-72f89701acfc', 'PG',       'G'],
    ['d940f3c6-57f7-44a8-b765-bcdc7d6cfc9a', 'PF-SF',    'F'],
    ['69843219-f388-4e77-bc91-7a8856193168', 'C-PF',     'UTIL'],
    ['e944234a-1e6b-438c-b104-aae33c0929d1', 'PF-SF-SG', 'UTIL'],
    ['8e206e68-2647-4436-b52d-d460d166189f', 'PG-SG',    'UTIL'],
    ['a604bb9c-a6a4-4a3f-958e-df95ba58df27', 'PG-SF-SG', 'BE'],
    ['3895adb2-6144-4da5-b529-b7547f2fe85c', 'C-PF',     'BE'],
    ['c13c19c5-d17f-438b-b379-67cb21fa4f43', 'C',        'BE'],
  ],
  3: [ // Swish Kings (was Church)
    ['aa17549f-2ddf-492c-b1bb-427a5dbec678', 'PG',       'PG'],
    ['a3d95b31-265f-4d56-bb42-6bcfceb31f8b', 'SF-SG',    'SG'],
    ['7413ffb9-f05e-4687-b79a-a20678282f04', 'PF-SF-SG', 'SF'],
    ['14914116-c9cf-4b32-9590-fb9b112378f5', 'PF',       'PF'],
    ['2572f534-e2ce-4dd4-a460-7e752bf83144', 'C',        'C'],
    ['937346b1-0e32-47f4-9448-1a9629d6a224', 'PG',       'G'],
    ['fcf22216-9800-47dd-abb1-04de5fab4595', 'PF-SF',    'F'],
    ['083b1c9d-66f5-4012-9491-79247ad6e8a5', 'PF-C',     'UTIL'],
    ['04c2d06e-5e48-446b-b111-41d454d6d3ca', 'PG-SG',    'UTIL'],
    ['272cbe6a-b50b-46a4-974a-0613c9c1a072', 'C',        'UTIL'],
    ['7b3fda82-8074-4bfa-a955-a9a02423e4f0', 'PF-SF',    'BE'],
    ['56e25e4c-d17a-4fe5-a59d-89fc068613aa', 'PG',       'BE'],
    ['7c6ad340-09c8-4e21-8c14-d7a3d2342f75', 'SF-SG',    'BE'],
  ],
  4: [ // Glass Eaters (was Engelhardt)
    ['6f21e902-f378-4a25-a2ab-15c8bc3f2c19', 'PG',       'PG'],
    ['d6dcf1ba-3918-4f14-924c-01aa2d35be6c', 'PG-SG',    'SG'],
    ['a4f7fea7-5e8d-4572-b892-7970049c8931', 'PF-SF',    'SF'],
    ['3a3356cd-0447-4b90-8a9f-53c776e92d42', 'PF-SF',    'PF'],
    ['53ba47f0-7121-4740-af77-6ade8ba807af', 'C',        'C'],
    ['1ff3b745-48c7-40f4-a7e2-948dd2a12d95', 'PG-SG',    'G'],
    ['d6b9ede0-685a-4133-9287-6382ea0d37c1', 'F',        'F'],
    ['473e53cc-c6e5-410a-9ce0-ca1727c789a4', 'C',        'UTIL'],
    ['c9c13181-33d4-4637-99fa-7c94676dd38d', 'PG-SG',    'UTIL'],
    ['534e97d5-a4fe-4d46-a763-8a8c43fe0710', 'PG-SG',    'UTIL'],
    ['cefb61ec-8561-4c58-9ae8-76b3d84d3d45', 'PG-SG',    'BE'],
    ['d37c0741-0bad-452b-bd45-6602e4d9dda5', 'C-PF',     'BE'],
    ['dad6b424-5835-432e-a01c-570529e21a5a', 'C-PF',     'BE'],
  ],
  5: [ // Court Vision (was Proton)
    ['bb2764ff-7d0d-48a2-88be-4146d47800a1', 'PG-SG',    'PG'],
    ['ef872c6e-270f-4b5f-a34d-73edb21cb4d0', 'PG-SF-SG', 'SG'],
    ['9ca0d830-ae6c-4561-87f6-226124a6e74a', 'PF-SF',    'SF'],
    ['4b51e55d-1eed-48b8-a0cb-4849d23c6d72', 'PF',       'PF'],
    ['1e1f0e9a-76c4-4907-a0cd-ec7ce266f50d', 'C-PF',     'C'],
    ['b2e4fd7c-4d83-4a54-8aca-54a71f2e7269', 'PG',       'G'],
    ['cdac1109-0e34-4f07-b9e3-7f70c12fcea6', 'PF-SF-SG', 'F'],
    ['d835346b-9432-4929-bff3-4a6843c182d7', 'PF-SF',    'UTIL'],
    ['6136e3c8-5839-445d-99fe-1c8d845fa58e', 'PF-SF-SG', 'UTIL'],
    ['75362e39-db7f-4192-98bc-b8fd0fb687ed', 'PG-SG',    'UTIL'],
    ['1d345181-52ff-4800-b579-0203e3c3542c', 'PG-SG',    'BE'],
    ['164e0b6a-9dc6-4b43-895c-f2a379d849aa', 'C',        'BE'],
    ['aa5f4fc9-1aef-4ea9-96b4-ba99d9b17b8c', 'C-PF',     'BE'],
  ],
};

// --- helpers ---

function err(msg, detail) {
  console.error(`\n❌ ${msg}`);
  if (detail) console.error(detail);
  process.exit(1);
}

async function findUserByEmail(email) {
  // admin.listUsers paginates; search all pages (we won't have many).
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
    page++;
  }
}

async function deleteExistingUsers() {
  console.log('→ Cleaning up any existing demo/bot users...');
  for (const { email } of USERS) {
    const existing = await findUserByEmail(email);
    if (existing) {
      // Cascade-delete any owned leagues first so team FK constraints don't block delete.
      const { data: leagues } = await admin.from('leagues').select('id').eq('created_by', existing.id);
      if (leagues?.length) {
        const leagueIds = leagues.map((l) => l.id);
        console.log(`  deleting ${leagueIds.length} league(s) owned by ${email}`);
        await admin.from('leagues').delete().in('id', leagueIds);
      }
      const { error } = await admin.auth.admin.deleteUser(existing.id);
      if (error && !String(error.message).includes('not found')) {
        err(`Failed to delete user ${email}`, error);
      }
      console.log(`  deleted ${email}`);
    }
  }
}

async function createUsers() {
  console.log('→ Creating 6 auth users...');
  const out = {};
  for (const u of USERS) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: u.name },
    });
    if (error) err(`Failed to create ${u.email}`, error);
    out[u.key] = { ...u, id: data.user.id };
    console.log(`  ${u.email} → ${data.user.id}`);
  }
  return out;
}

async function seedLeague(users) {
  console.log('→ Inserting league...');
  const commissionerId = users.demo.id;

  // Season dates: week 1 starts 6 days ago (so we're in week 2 "today").
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7)); // nearest Mon
  const wk1Start = new Date(weekStart);
  wk1Start.setUTCDate(wk1Start.getUTCDate() - 7);
  const wk1End = new Date(wk1Start); wk1End.setUTCDate(wk1End.getUTCDate() + 6);
  const wk2Start = new Date(weekStart);
  const wk2End = new Date(wk2Start); wk2End.setUTCDate(wk2End.getUTCDate() + 6);
  const iso = (d) => d.toISOString().slice(0, 10);

  const { data: league, error: leagueErr } = await admin.from('leagues').insert({
    name: 'Demo Dynasty',
    created_by: commissionerId,
    league_type: 'redraft',
    teams: 6,
    current_teams: 6,
    roster_size: 13,
    season: '2025-26',
    regular_season_weeks: 2,
    playoff_weeks: 0,
    playoff_teams: 0,
    season_start_date: iso(wk1Start),
    trade_review_period_hours: 0,
    trade_veto_type: 'none',
    scoring_type: 'h2h_categories',
    draft_pick_trading_enabled: false,
    pick_conditions_enabled: false,
    max_future_seasons: 0,
    rookie_draft_rounds: 0,
    rookie_draft_order: 'reverse_record',
    waiver_type: 'standard',
    waiver_period_days: 1,
    player_lock_type: 'individual_game',
    initial_draft_order: 'random',
    division_count: 1,
    schedule_generated: true,
    weekly_acquisition_limit: 4,
  }).select().single();
  if (leagueErr) err('Failed to insert league', leagueErr);
  const leagueId = league.id;

  console.log('→ Inserting 6 teams...');
  const teamRows = USERS.map((u, i) => ({
    league_id: leagueId,
    user_id: users[u.key].id,
    name: u.name,
    tricode: u.tricode,
    is_commissioner: u.commish,
    division: 1,
  }));
  const { data: teams, error: teamErr } = await admin.from('teams').insert(teamRows).select();
  if (teamErr) err('Failed to insert teams', teamErr);
  // Reorder by user_id to match USERS order (insert order not guaranteed to return sorted).
  const teamByKey = {};
  USERS.forEach((u) => {
    teamByKey[u.key] = teams.find((t) => t.user_id === users[u.key].id);
  });
  const teamByIdx = USERS.map((u) => teamByKey[u.key]);

  console.log('→ Inserting roster config + scoring...');
  const rosterConfig = [
    ['PG', 1], ['SG', 1], ['SF', 1], ['PF', 1], ['C', 1],
    ['G', 1], ['F', 1], ['UTIL', 3], ['BE', 3], ['IR', 1],
  ].map(([position, slot_count]) => ({ league_id: leagueId, position, slot_count }));
  const { error: rcErr } = await admin.from('league_roster_config').insert(rosterConfig);
  if (rcErr) err('roster config', rcErr);

  const scoringCats = ['PTS','REB','AST','STL','BLK','TO','3PM','FG%','FT%'];
  const scoringRows = scoringCats.map((stat_name) => ({
    league_id: leagueId, stat_name, point_value: 0, is_enabled: true, inverse: stat_name === 'TO',
  }));
  const { error: scErr } = await admin.from('league_scoring_settings').insert(scoringRows);
  if (scErr) err('scoring settings', scErr);

  console.log('→ Inserting draft + picks...');
  const { data: draft, error: draftErr } = await admin.from('drafts').insert({
    league_id: leagueId, season: '2025-26', type: 'initial', status: 'complete',
    rounds: 13, picks_per_round: 6, time_limit: 60, draft_type: 'snake', current_pick_number: 79,
  }).select().single();
  if (draftErr) err('drafts', draftErr);

  const draftPickRows = DRAFT_PICKS.map(([round, teamIdx, player_id], i) => {
    const team = teamByIdx[teamIdx];
    return {
      league_id: leagueId,
      draft_id: draft.id,
      season: '2025-26',
      round,
      pick_number: i + 1,
      slot_number: teamIdx + 1,
      original_team_id: team.id,
      current_team_id: team.id,
      player_id,
      selected_at: new Date().toISOString(),
    };
  });
  const { error: dpErr } = await admin.from('draft_picks').insert(draftPickRows);
  if (dpErr) err('draft_picks', dpErr);

  console.log('→ Inserting league_players (rosters)...');
  const rosterRows = [];
  for (const [idx, roster] of Object.entries(ROSTERS)) {
    const team = teamByIdx[Number(idx)];
    for (const [player_id, position, roster_slot] of roster) {
      rosterRows.push({
        league_id: leagueId,
        team_id: team.id,
        player_id,
        position,
        roster_slot,
        acquired_via: 'draft',
        acquired_at: new Date().toISOString(),
      });
    }
  }
  const { error: lpErr } = await admin.from('league_players').insert(rosterRows);
  if (lpErr) err('league_players', lpErr);

  console.log('→ Inserting schedule + matchups...');
  const { data: sched, error: sErr } = await admin.from('league_schedule').insert([
    { league_id: leagueId, season: '2025-26', week_number: 1, start_date: iso(wk1Start), end_date: iso(wk1End), is_playoff: false },
    { league_id: leagueId, season: '2025-26', week_number: 2, start_date: iso(wk2Start), end_date: iso(wk2End), is_playoff: false },
  ]).select();
  if (sErr) err('schedule', sErr);
  const sched1 = sched.find((s) => s.week_number === 1);
  const sched2 = sched.find((s) => s.week_number === 2);

  const t = teamByIdx;
  const matchupRows = [
    { league_id: leagueId, schedule_id: sched1.id, week_number: 1, home_team_id: t[0].id, away_team_id: t[5].id },
    { league_id: leagueId, schedule_id: sched1.id, week_number: 1, home_team_id: t[1].id, away_team_id: t[4].id },
    { league_id: leagueId, schedule_id: sched1.id, week_number: 1, home_team_id: t[2].id, away_team_id: t[3].id },
    { league_id: leagueId, schedule_id: sched2.id, week_number: 2, home_team_id: t[0].id, away_team_id: t[4].id },
    { league_id: leagueId, schedule_id: sched2.id, week_number: 2, home_team_id: t[5].id, away_team_id: t[3].id },
    { league_id: leagueId, schedule_id: sched2.id, week_number: 2, home_team_id: t[1].id, away_team_id: t[2].id },
  ];
  const { error: mErr } = await admin.from('league_matchups').insert(matchupRows);
  if (mErr) err('matchups', mErr);

  console.log('→ Inserting waiver priority...');
  const waiverRows = teamByIdx.map((team, i) => ({
    league_id: leagueId, team_id: team.id, priority: i + 1, faab_remaining: 100,
  }));
  const { error: wErr } = await admin.from('waiver_priority').insert(waiverRows);
  if (wErr) console.warn(`⚠️  waiver_priority insert failed (non-fatal): ${wErr.message}`);

  return { leagueId, teamByIdx };
}

async function main() {
  console.log('=== Franchise Fantasy — Seed Demo Account ===\n');
  await deleteExistingUsers();
  const users = await createUsers();
  const { leagueId } = await seedLeague(users);

  console.log('\n✅ Done!\n');
  console.log('─────────────────────────────────────────────');
  console.log('  Demo credentials for App Store Connect:');
  console.log('─────────────────────────────────────────────');
  console.log(`  Email:    ${DEMO_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log(`  League:   Demo Dynasty (${leagueId})`);
  console.log('─────────────────────────────────────────────\n');
}

main().catch((e) => {
  console.error('\n❌ Unhandled error:');
  console.error(e);
  process.exit(1);
});
