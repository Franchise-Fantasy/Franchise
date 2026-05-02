import { Image, type ImageContentFit, type ImageSource } from "expo-image";
import { useEffect, useRef } from "react";
import {
  Animated,
  type StyleProp,
  type ImageStyle,
  Text,
  View,
} from "react-native";

import { PLAYER_SILHOUETTE } from "@/utils/nba/playerHeadshot";

import { freeAgentListStyles as styles } from "./freeAgentListStyles";

export const SKELETON_COUNT = 8;

export function SkeletonRow({ color, index }: { color: string; index: number }) {
  const pulse = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          delay: index * 60,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.row, { borderBottomColor: color }]}>
      <Animated.View
        style={[
          styles.headshotCircle,
          {
            backgroundColor: color,
            opacity: pulse,
            marginRight: 10,
            borderWidth: 0,
          },
        ]}
      />
      <View style={styles.info}>
        <Animated.View
          style={[
            styles.skeletonBar,
            { width: 120, backgroundColor: color, opacity: pulse },
          ]}
        />
        <Animated.View
          style={[
            styles.skeletonBar,
            { width: 40, marginTop: 4, backgroundColor: color, opacity: pulse },
          ]}
        />
      </View>
      <View style={styles.rightSide}>
        <View style={styles.stats}>
          <Animated.View
            style={[
              styles.skeletonBar,
              { width: 60, backgroundColor: color, opacity: pulse },
            ]}
          />
          <Animated.View
            style={[
              styles.skeletonBar,
              {
                width: 44,
                marginTop: 4,
                backgroundColor: color,
                opacity: pulse,
              },
            ]}
          />
        </View>
        <Animated.View
          style={[styles.addButton, { backgroundColor: color, opacity: pulse }]}
        >
          <Text style={styles.addButtonText}> </Text>
        </Animated.View>
      </View>
    </View>
  );
}

export function SkeletonRibbon({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.ribbonScroll, styles.ribbonContent]}>
      <Animated.View
        style={[
          styles.ribbonPill,
          { borderColor: color, opacity: pulse, width: 80, height: 28 },
        ]}
      />
      <Animated.View
        style={[
          styles.ribbonPill,
          { borderColor: color, opacity: pulse, width: 72, height: 28 },
        ]}
      />
      <Animated.View
        style={[
          styles.ribbonPill,
          { borderColor: color, opacity: pulse, width: 68, height: 28 },
        ]}
      />
    </View>
  );
}

export function FadeInImage({
  uri,
  style,
  contentFit = "cover",
  placeholder = PLAYER_SILHOUETTE,
}: {
  uri: string | null | undefined;
  style: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  placeholder?: ImageSource | number;
}) {
  // The silhouette is a small centered icon on whitespace — `cover` would
  // crop out its body. `cover` is still right for real headshots.
  return (
    <Image
      source={uri ? { uri } : placeholder}
      style={style}
      contentFit={uri ? contentFit : "contain"}
      cachePolicy="memory-disk"
      recyclingKey={uri ?? "silhouette"}
      placeholder={placeholder}
      placeholderContentFit="contain"
      transition={250}
    />
  );
}
