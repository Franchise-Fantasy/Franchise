import { Tabs } from 'expo-router';
import React from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { Fonts } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';

const ICON_SIZE = 24;

export default function TabLayout() {
  const c = useColors();
  const { teamId } = useAppState();
  const { data: league } = useLeague();
  const myTeam = (league?.league_teams ?? []).find((t: any) => t.id === teamId);
  const logoKey = myTeam?.logo_key ?? null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.tabIconSelected,
        tabBarInactiveTintColor: c.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarLabelStyle: {
          fontFamily: Fonts.varsitySemibold,
          fontSize: 10,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        },
        // Nudge the icon/label pair down a touch so it sits more centered
        // against the top of the bar — iOS defaults line them tight against
        // the top edge which reads as "crowded up top, empty at bottom".
        tabBarItemStyle: {
          paddingTop: 6,
        },
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
          },
          default: {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
          },
        }),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={ICON_SIZE} name="house.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="matchup"
        options={{
          title: 'Matchup',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={ICON_SIZE} name="sportscourt" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="roster"
        options={{
          title: 'Roster',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={ICON_SIZE} name="person.3.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="free-agents"
        options={{
          title: 'Players',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={ICON_SIZE} name="person.badge.plus" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) =>
            logoKey?.startsWith('http') ? (
              <View style={[tabStyles.teamLogoRing, { borderColor: c.heritageGold }]}>
                <Image
                  source={{ uri: logoKey }}
                  style={tabStyles.teamLogoImg}
                  accessibilityLabel="Team logo"
                  accessibilityRole="image"
                />
              </View>
            ) : (
              <IconSymbol size={ICON_SIZE} name="person.crop.circle" color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  teamLogoRing: {
    width: ICON_SIZE + 2,
    height: ICON_SIZE + 2,
    borderRadius: (ICON_SIZE + 2) / 2,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLogoImg: {
    width: ICON_SIZE - 2,
    height: ICON_SIZE - 2,
    borderRadius: (ICON_SIZE - 2) / 2,
  },
});
