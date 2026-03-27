import { Tabs } from 'expo-router';
import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { teamId } = useAppState();
  const { data: league } = useLeague();
  const myTeam = (league?.league_teams ?? []).find((t: any) => t.id === teamId);
  const logoKey = myTeam?.logo_key ?? null;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
          },
          default: {},
        }),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />

  
<Tabs.Screen
        name="matchup"
        options={{
          title: 'Matchup',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="sportscourt" color={color} />,
        }}
      />
      
          <Tabs.Screen
        name="roster"
        options={{
          title: 'Roster',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.3.fill" color={color} />,
        }}
      />


      <Tabs.Screen
        name="free-agents"
        options={{
          title: 'Players',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="person.badge.plus" color={color} />,
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) =>
            logoKey?.startsWith('http') ? (
              <Image
                source={{ uri: logoKey }}
                style={tabStyles.teamLogo}
                accessibilityLabel="Team logo"
                accessibilityRole="image"
              />
            ) : (
              <IconSymbol size={28} name="person.crop.circle" color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  teamLogo: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
});
