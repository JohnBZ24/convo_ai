import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MIN_PASSWORD_LENGTH, useAuthStore } from "~/features/auth/auth-store";
import { colors, spacing, typography } from "~/theme/tokens";

/**
 * The only screen in the app with a keyboard.
 *
 * The voice screen has no text input by design; this exists solely because an
 * account has to come from somewhere.
 */
export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const { signIn, signUp, busy, error, clearError } = useAuthStore();

  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isSignUp = mode === "sign-up";
  const canSubmit =
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    (!isSignUp || name.trim().length > 0);

  const submit = () => {
    if (!canSubmit || busy) return;
    if (isSignUp) void signUp(name.trim(), email.trim(), password);
    else void signIn(email.trim(), password);
  };

  const toggleMode = () => {
    clearError();
    setMode(isSignUp ? "sign-in" : "sign-up");
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.body}>
        <Text style={styles.heading}>Convo AI</Text>
        <Text style={styles.subheading}>
          {isSignUp
            ? "Create an account to start talking."
            : "Sign in to start talking."}
        </Text>

        {isSignUp ? (
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={colors.muted}
            autoCapitalize="words"
            autoComplete="name"
          />
        ) : null}

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
        />

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder={`Password (${MIN_PASSWORD_LENGTH}+ characters)`}
          placeholderTextColor={colors.muted}
          secureTextEntry
          autoCapitalize="none"
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.submit, !canSubmit && styles.submitDisabled]}
          onPress={submit}
          disabled={!canSubmit || busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.submitLabel}>
              {isSignUp ? "Create account" : "Sign in"}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={toggleMode}
          accessibilityRole="button"
          style={styles.toggle}
        >
          <Text style={styles.toggleLabel}>
            {isSignUp ? "I already have an account" : "Create an account"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  heading: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "700",
    color: colors.text,
  },
  subheading: {
    ...typography.body,
    color: colors.muted,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginBottom: spacing.md,
  },
  submit: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitLabel: {
    ...typography.title,
    color: colors.background,
    fontWeight: "600",
  },
  toggle: {
    marginTop: spacing.lg,
    alignItems: "center",
  },
  toggleLabel: {
    ...typography.body,
    color: colors.muted,
  },
});
