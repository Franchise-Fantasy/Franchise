import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors } from "@/constants/Colors";
import { capture, posthog } from "@/lib/posthog";

type Props = {
  children: React.ReactNode;
  fallback?: (reset: () => void, error: Error) => React.ReactNode;
};

type State = {
  error: Error | null;
  resetKey: number;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      posthog.capture("$exception", {
        $exception_message: error.message,
        $exception_type: error.name,
        $exception_stack_trace_raw: error.stack ?? null,
        componentStack: info.componentStack ?? null,
        source: "ErrorBoundary",
      });
      capture("app_error_boundary_caught", {
        message: error.message,
        name: error.name,
      });
    } catch {
      // Never let the error reporter crash the boundary
    }
  }

  reset = () => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    const { error, resetKey } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(this.reset, error);
      return (
        <View
          style={styles.container}
          accessibilityRole="alert"
          accessibilityLabel="Something went wrong"
        >
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message} numberOfLines={4}>
            {error.message || "An unexpected error occurred."}
          </Text>
          <Pressable
            onPress={this.reset}
            style={styles.button}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: Colors.dark.background,
  },
  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
  },
  message: {
    color: "#bbb",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#2563eb",
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
