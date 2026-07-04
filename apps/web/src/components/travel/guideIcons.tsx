import {
  Globe2,
  Coins,
  PlaneTakeoff,
  Bot,
  Backpack,
  Leaf,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import type { GuideCategory } from "@/lib/travel/guides";

// One icon per guide category, shared by the hub and article pages.
export const GUIDE_CATEGORY_ICONS: Record<GuideCategory, LucideIcon> = {
  Destinations: Globe2,
  "Crypto Payments": Coins,
  Tutorials: PlaneTakeoff,
  "AI Agents": Bot,
  "Tips & Packing": Backpack,
  "Sustainable Travel": Leaf,
  "Cards & Rewards": CreditCard,
};
