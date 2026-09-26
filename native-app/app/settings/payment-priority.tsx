import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { Button, Screen, EmptyState } from "@/components/ui";
import { useOverview } from "@/lib/queries";
import { getPaymentPriority, setPaymentPriority, PaymentAsset } from "@/lib/payments/prioritySelector";
import { colors, spacing, type } from "@/lib/theme";

export default function PaymentPriorityScreen() {
  const router = useRouter();
  const { data: overviewResult, isLoading: isOverviewLoading } = useOverview();
  const tokenBalances = overviewResult?.data.tokenBalances || [];

  const [order, setOrder] = useState<PaymentAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadPriority();
  }, []);

  const loadPriority = async () => {
    try {
      const currentOrder = await getPaymentPriority();
      setOrder(currentOrder);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await setPaymentPriority(order);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      console.error(e);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...order];
    const temp = newOrder[index - 1];
    newOrder[index - 1] = newOrder[index];
    newOrder[index] = temp;
    setOrder(newOrder);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const moveDown = (index: number) => {
    if (index === order.length - 1) return;
    const newOrder = [...order];
    const temp = newOrder[index + 1];
    newOrder[index + 1] = newOrder[index];
    newOrder[index] = temp;
    setOrder(newOrder);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const getBalance = (asset: PaymentAsset) => {
    const balance = tokenBalances.find(tb => tb.token === asset);
    return balance ? balance.amount : 0;
  };

  if (isLoading || isOverviewLoading) {
    return (
      <Screen>
        <View style={styles.centered} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={type.h2}>Payment Priority</Text>
          <Text style={type.dim}>
            Order the assets you prefer to use when paying. We'll try the first one, then fall back down the list.
          </Text>
        </View>

        <View style={styles.list}>
          {order.map((asset, index) => (
            <View key={asset} style={styles.row}>
              <View style={styles.iconCircle}>
                <Text style={styles.iconText}>{asset[0]}</Text>
              </View>
              
              <View style={styles.assetInfo}>
                <Text style={styles.assetName}>{asset}</Text>
                <Text style={styles.assetBalance}>{getBalance(asset)} available</Text>
              </View>

              <View style={styles.controls}>
                <TouchableOpacity
                  onPress={() => moveUp(index)}
                  disabled={index === 0}
                  style={styles.arrowBtn}
                >
                  <Ionicons name="chevron-up" size={24} color={index === 0 ? colors.border : colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => moveDown(index)}
                  disabled={index === order.length - 1}
                  style={styles.arrowBtn}
                >
                  <Ionicons name="chevron-down" size={24} color={index === order.length - 1 ? colors.border : colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.footer}>
          <Button
            title="Save Order"
            onPress={handleSave}
            loading={isSaving}
            disabled={isSaving}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: spacing.md,
    gap: spacing.xl,
  },
  header: {
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 12,
    gap: spacing.md,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.border,
    justifyContent: "center",
    alignItems: "center",
  },
  iconText: {
    ...type.body,
    fontWeight: "bold",
    color: colors.text,
  },
  assetInfo: {
    flex: 1,
  },
  assetName: {
    ...type.body,
    fontWeight: "600",
    color: colors.text,
  },
  assetBalance: {
    ...type.dim,
    fontSize: 13,
    marginTop: 2,
  },
  controls: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  arrowBtn: {
    padding: 4,
  },
  footer: {
    paddingTop: spacing.lg,
  },
});
