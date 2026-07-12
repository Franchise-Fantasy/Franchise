import React, { useState } from "react";
import { Image, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";

// The expected access code's SHA-256 hash. Set in .env.local (local) and the web
// host's build env (deploy). The plaintext code is NEVER in the bundle — only its
// hash — so inspecting the JS can't reveal it. With no hash configured the gate is
// disabled, so local `npm run web` isn't gated.
const EXPECTED_HASH = process.env.EXPO_PUBLIC_WEB_BETA_CODE_HASH;
const STORAGE_KEY = "franchise_web_beta_ok";
const PATCH = require("@/assets/images/F_patch.png");

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Private-beta gate for the web app. Blocks the whole app (including login) behind
 * a shared access code until the visitor enters it once; the pass is remembered in
 * localStorage. This keeps the public out during the TestFlight beta — layered on
 * top of the app's existing login + league-invite requirements. Web-only.
 */
export function BetaGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === EXPECTED_HASH;
    } catch {
      return false;
    }
  });

  if (!EXPECTED_HASH || unlocked) return <>{children}</>;

  return <GateScreen expectedHash={EXPECTED_HASH} onUnlock={() => setUnlocked(true)} />;
}

function GateScreen({ expectedHash, onUnlock }: { expectedHash: string; onUnlock: () => void }) {
  const c = useColors();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setError(false);
    try {
      if ((await sha256Hex(trimmed)) === expectedHash) {
        try {
          window.localStorage.setItem(STORAGE_KEY, expectedHash);
        } catch {
          // Private mode / storage disabled — unlock for this session anyway.
        }
        onUnlock();
        return;
      }
    } catch {
      // crypto.subtle unavailable (insecure context) — fall through to error.
    }
    setError(true);
    setChecking(false);
  };

  const canSubmit = !!code.trim() && !checking;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <Image source={PATCH} style={styles.patch} resizeMode="contain" accessibilityLabel="Franchise" accessibilityRole="image" />
        <ThemedText type="varsity" style={[styles.title, { color: c.text }]} accessibilityRole="header">
          PRIVATE BETA
        </ThemedText>
        <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
          Franchise on the web is invite-only right now. Enter your access code to continue.
        </ThemedText>
        <TextInput
          value={code}
          onChangeText={(t) => {
            setCode(t);
            setError(false);
          }}
          placeholder="Access code"
          placeholderTextColor={c.secondaryText}
          style={[styles.input, { color: c.text, backgroundColor: c.cardAlt, borderColor: error ? c.danger : c.border }]}
          autoCapitalize="characters"
          autoCorrect={false}
          onSubmitEditing={submit}
          accessibilityLabel="Access code"
        />
        {error && (
          <ThemedText style={[styles.error, { color: c.danger }]}>That code isn&apos;t right. Try again.</ThemedText>
        )}
        <TouchableOpacity
          style={[styles.button, { backgroundColor: canSubmit ? c.gold : c.buttonDisabled }]}
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Enter"
        >
          <ThemedText type="varsity" style={[styles.buttonText, { color: Colors.light.text }]}>
            {checking ? "Checking…" : "Enter"}
          </ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: "center",
  },
  patch: {
    width: 52,
    height: 49,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    letterSpacing: 2,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    letterSpacing: 1,
  },
  error: {
    fontSize: 12,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  button: {
    width: "100%",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 16,
  },
  buttonText: {
    fontSize: 13,
    letterSpacing: 1.2,
  },
});
