import React from "react";
import { StyleSheet } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

// The tab bar is deliberately low-weight: a hairline instead of a 1px border,
// a small label, and the same black as the page so it reads as part of the
// surface rather than a chrome strip laid on top of it.
//
// ACTIVE STAYS MINT, NOT WHITE. Every other selected state in this app — swap
// chips, slippage presets, the send confirm knob — is colors.neon. Making the
// tab bar the one place selection means white would be a second visual language
// for the same idea.

export default function TabsLayout() {
  const status = useAuth((s) => s.status);
  if (status !== "signedIn") return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: "rgba(255,255,255,0.08)",
          height: 62,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginBottom: 6 },
        tabBarActiveTintColor: colors.neon,
        tabBarInactiveTintColor: colors.textFaint,
        sceneStyle: { backgroundColor: colors.bg },
        // On Android the bar otherwise rides up on top of the keyboard and sits
        // over the field being typed into — most visibly on Send, where the
        // amount and recipient are both keyboard-driven.
        tabBarHideOnKeyboard: true,
        // Unfocused tabs stop re-rendering entirely. Without this, a balance
        // refetch re-renders Cards, Invest and Settings as well as the screen
        // actually on screen — work whose result nobody can see.
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="send"
        options={{
          title: "Send",
          tabBarIcon: ({ color, size }) => <Ionicons name="paper-plane-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cards"
        options={{
          title: "Cards",
          tabBarIcon: ({ color, size }) => <Ionicons name="card-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="invest"
        options={{
          title: "Invest",
          tabBarIcon: ({ color, size }) => <Ionicons name="trending-up-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
