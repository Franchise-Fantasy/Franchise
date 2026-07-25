# Contentful Setup — Status & Remaining Steps

## Already done (July 25, 2026, with Claude driving the Contentful UI)

- **Old prospect entries archived** (not deleted — recoverable anytime under
  Content → Archived). The old content type was renamed **Prospect (Legacy)**
  (ID `prospect`) and is no longer used by anything.
- **New content type created: `prospectProfile`** (display name "Prospect"),
  14 fields:

  | Field ID | Type | Notes |
  |---|---|---|
  | `name` | Short text, required | Entry title |
  | `slug` | Short text, **required + unique** | Join key with Supabase (`aj-dybantsa`) |
  | `sport` | Short text, required | `NBA` or `NFL` (job always writes `NBA`) |
  | `position` | Short text | auto-filled |
  | `school` | Short text | college/international team, auto-filled |
  | `currentTeam` | Short text | actual NBA team once drafted (post-trade), auto-filled |
  | `height`, `weight` | Short text | auto-filled from scouting boards |
  | `hometown`, `classYear` | Short text | editorial |
  | `draftYear` | Integer | auto-filled |
  | `photo` | Media (one file) | editorial |
  | `scoutingReport` | Rich text | editorial |
  | `youTubeId` | Short text | editorial — see video rules below |

## Remaining for Noah

1. **Create the management token**: Settings → API keys → Content management
   tokens → Generate personal token, name it `rankings-pipeline`. Copy it
   immediately (shown once) and pass it to the programmer **privately**
   (password manager / ephemeral link — never plain email or text). Also give
   them the Space ID: `652mhs62v69t`.
2. Optional polish: the `sport` field currently accepts any text. To give
   editors an NBA/NFL dropdown: Content model → Prospect → Edit `sport` →
   Validation → "Accept only specified values" → type `NBA`, press Enter, type
   `NFL`, press Enter → Confirm → Save. (Purely cosmetic — the job always
   writes valid values.)

## Ongoing editorial workflow

After each weekly run, new players appear as **unpublished drafts** with all
the machine fields pre-filled. Your team adds `photo`, `scoutingReport`,
`hometown`, `youTubeId` — then publishes. Nothing shows in the app until
published; the job never modifies an entry that already exists.

### YouTube video rules (`youTubeId` field)

Store just the video ID (the `dQw4...` part of the URL), from **official
channels only** — the school, NBA, ESPN, Bleacher Report, or the player's own
channel. Never fan re-uploads of network footage. Embedding the official
player is what keeps this legally clean (uploader keeps views/ads). If a video
dies, the app hides the section; swap in a fresh ID whenever.
