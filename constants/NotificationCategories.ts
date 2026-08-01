import type { Ionicons } from '@expo/vector-icons';

import type { PushPreferences } from '@/constants/NotificationPrefs';

/**
 * The single source of truth for how notification categories are presented.
 *
 * Both the global settings screen (app/notification-settings.tsx) and the
 * per-league override sheet (components/banners/LeagueNotificationModal.tsx)
 * render from this list, so a category can't appear in one and not the other,
 * and a description can't drift between them.
 *
 * Descriptions must describe what ACTUALLY fires. If you add a send site that
 * rides an existing category, update the description here in the same commit —
 * a toggle whose label undersells its scope is how someone mutes their league
 * invite while trying to mute force-moves.
 */
export interface NotificationCategory {
  key: keyof PushPreferences;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  /** Rendered indented under, and disabled by, this parent category. */
  parentKey?: keyof PushPreferences;
}

export interface NotificationGroup {
  title: string;
  categories: NotificationCategory[];
}

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    title: 'Your Team',
    categories: [
      {
        key: 'draft',
        icon: 'basketball-outline',
        label: 'Draft',
        description: "When you're on the clock, plus draft start, pauses, and autopicks",
      },
      {
        key: 'matchups',
        icon: 'stats-chart-outline',
        label: 'Matchup Results',
        description: 'Your final score when the week is scored',
      },
      {
        key: 'matchup_closeup',
        icon: 'flash-outline',
        label: 'Close Matchup Alerts',
        description: 'A nudge when your week is going down to the wire',
        parentKey: 'matchups',
      },
      {
        key: 'waivers',
        icon: 'hourglass-outline',
        label: 'Waiver Results',
        description: 'Whether your claim won or lost, and FAAB bid results',
      },
      {
        key: 'injuries',
        icon: 'medkit-outline',
        label: 'Injury Updates',
        description: 'Status changes for players on your roster',
      },
      {
        key: 'player_news',
        icon: 'newspaper-outline',
        label: 'Player News',
        description: 'Beat-reporter updates on players you roster. Can be several a day.',
      },
    ],
  },
  {
    title: 'Trades',
    categories: [
      {
        key: 'trades',
        icon: 'swap-horizontal-outline',
        label: 'Trades',
        description: 'Offers sent to you, plus accepts, vetoes, and completed deals',
      },
      {
        key: 'trade_block',
        icon: 'hand-left-outline',
        label: 'Trade Block Interest',
        description: "When someone wants a player you've listed",
        parentKey: 'trades',
      },
      {
        key: 'trade_rumors',
        icon: 'ear-outline',
        label: 'Trade Rumors',
        description: 'Leaked and auto-generated rumors posted in league chat',
        parentKey: 'trades',
      },
    ],
  },
  {
    title: 'Postseason',
    categories: [
      {
        key: 'playoffs',
        icon: 'trophy-outline',
        label: 'Playoff Alerts',
        description: 'Bracket seeding, your seed pick turn, and the championship',
      },
      {
        key: 'lottery',
        icon: 'dice-outline',
        label: 'Draft Lottery',
        description: 'Lottery results and where your pick landed',
      },
    ],
  },
  {
    title: 'League',
    categories: [
      {
        key: 'direct_messages',
        icon: 'mail-outline',
        label: 'Direct Messages',
        description: 'Private messages sent to you by a league member',
      },
      {
        key: 'chat',
        icon: 'chatbubbles-outline',
        label: 'League Chat',
        description: 'Every new message in the league-wide chat room',
      },
      {
        key: 'commissioner',
        icon: 'shield-outline',
        label: 'League Admin',
        description:
          'League invites, dues reminders, polls and surveys, roster cuts, and commissioner moves on your team',
      },
      {
        key: 'league_activity',
        icon: 'people-outline',
        label: 'League Milestones',
        description: 'Season start, keepers locked in, and offseason stage changes',
      },
      {
        key: 'roster_moves',
        icon: 'person-add-outline',
        label: 'League Roster Moves',
        description: 'Every add and drop by other teams. The busiest category.',
      },
    ],
  },
];

/** Flat list in display order — for screens that don't want the grouping. */
export const NOTIFICATION_CATEGORIES: NotificationCategory[] =
  NOTIFICATION_GROUPS.flatMap((g) => g.categories);

/**
 * Child categories keyed by their parent. Used to cascade a parent toggle off,
 * and to restore its children when the parent is switched back on.
 */
export const CHILD_KEYS: Partial<Record<keyof PushPreferences, (keyof PushPreferences)[]>> =
  NOTIFICATION_CATEGORIES.reduce(
    (acc, cat) => {
      if (cat.parentKey) (acc[cat.parentKey] ??= []).push(cat.key);
      return acc;
    },
    {} as Partial<Record<keyof PushPreferences, (keyof PushPreferences)[]>>,
  );
