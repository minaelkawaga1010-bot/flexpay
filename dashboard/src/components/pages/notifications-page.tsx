"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  BellOff,
  ArrowDownLeft,
  ArrowUpRight,
  Smartphone,
  Building2,
  ShieldCheck,
  Lock,
  Megaphone,
  CreditCard,
  PiggyBank,
  Settings,
  Mail,
  MessageSquare,
  CheckCheck,
  Circle,
  AlertTriangle,
  Clock,
  Sparkles,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────
interface NotificationItem {
  id: string;
  type: "transaction" | "payroll" | "security" | "promotion" | "loan" | "savings" | "system";
  subtype: string;
  title: string;
  body: string;
  time: string;
  channel: "PUSH" | "IN_APP" | "EMAIL" | "SMS";
  priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW";
  read: boolean;
}

interface NotificationSettings {
  channels: { push: boolean; inApp: boolean; email: boolean; sms: boolean };
  types: { transactions: boolean; payroll: boolean; security: boolean; promotions: boolean; system: boolean };
}

interface NotificationsData {
  notifications: NotificationItem[];
  unreadCount: number;
  settings: NotificationSettings;
}

// ── Mock Fallback ───────────────────────────────────────────────
const mockData: NotificationsData = {
  unreadCount: 5,
  notifications: [
    { id: "1", type: "transaction", subtype: "RECEIVED", title: "AED 500 received from Ahmed", body: "You have received AED 500.00 from Ahmed K. via P2P transfer. The amount has been credited to your FlexPay wallet.", time: "2 min ago", channel: "PUSH", priority: "HIGH", read: false },
    { id: "2", type: "transaction", subtype: "SENT", title: "AED 1,200 sent to Priya", body: "You sent AED 1,200.00 to Priya Sharma. Transaction reference: FPX-2025-0612-001. The amount has been debited.", time: "1 hour ago", channel: "PUSH", priority: "MEDIUM", read: false },
    { id: "3", type: "security", subtype: "LOGIN", title: "New login from iPhone 15", body: "A new login was detected from an iPhone 15 running iOS 18.5 in Dubai, UAE. If this wasn't you, please secure your account immediately.", time: "3 hours ago", channel: "IN_APP", priority: "HIGH", read: false },
    { id: "4", type: "payroll", subtype: "SALARY", title: "June salary of AED 8,500 credited", body: "Your June 2025 salary of AED 8,500.00 has been credited to your FlexPay wallet by Dubai Technologies LLC. Net after deductions.", time: "Yesterday", channel: "PUSH", priority: "URGENT", read: false },
    { id: "5", type: "security", subtype: "SECURITY", title: "Password changed successfully", body: "Your FlexPay account password was changed successfully. If you did not make this change, please contact support immediately.", time: "Yesterday", channel: "IN_APP", priority: "MEDIUM", read: true },
    { id: "6", type: "promotion", subtype: "PROMO", title: "Get 2x cashback on remittances this week!", body: "Limited time offer: Send money to any corridor this week and earn double cashback. Valid until June 15, 2025. T&Cs apply.", time: "2 days ago", channel: "PUSH", priority: "LOW", read: true },
    { id: "7", type: "loan", subtype: "REMINDER", title: "Loan payment of AED 520 due in 5 days", body: "Your salary advance loan payment of AED 520.00 is due on June 17, 2025. Ensure sufficient wallet balance for auto-deduction.", time: "3 days ago", channel: "PUSH", priority: "HIGH", read: true },
    { id: "8", type: "savings", subtype: "SAVINGS", title: "Emergency fund goal is 85% complete!", body: "Your Emergency Fund savings goal is 85% complete. You've saved AED 8,500 of your AED 10,000 target. Keep going!", time: "4 days ago", channel: "IN_APP", priority: "MEDIUM", read: true },
    { id: "9", type: "system", subtype: "SYSTEM", title: "Scheduled maintenance on June 20, 2-4 AM GST", body: "FlexPay will undergo scheduled maintenance on June 20, 2025 from 2:00 AM to 4:00 AM GST. Some services may be temporarily unavailable.", time: "5 days ago", channel: "PUSH", priority: "LOW", read: true },
    { id: "10", type: "promotion", subtype: "PROMO", title: "Invite friends and earn AED 50 each!", body: "Share your referral code with friends. When they sign up and complete KYC, both of you get AED 50 credited to your wallets.", time: "1 week ago", channel: "PUSH", priority: "LOW", read: true },
    { id: "11", type: "transaction", subtype: "REMITTANCE", title: "AED 3,500 remittance to India completed", body: "Your remittance of AED 3,500.00 to State Bank of India has been successfully processed. INR 79,975 credited to beneficiary account.", time: "1 week ago", channel: "PUSH", priority: "MEDIUM", read: true },
    { id: "12", type: "system", subtype: "SYSTEM", title: "Your KYC Level 2 has been verified", body: "Congratulations! Your KYC Level 2 verification has been approved. You now have access to higher transaction limits and premium features.", time: "2 weeks ago", channel: "EMAIL", priority: "HIGH", read: true },
  ],
  settings: {
    channels: { push: true, inApp: true, email: false, sms: false },
    types: { transactions: true, payroll: true, security: true, promotions: true, system: true },
  },
};

// ── Static Data ─────────────────────────────────────────────────
const filterTabs = [
  { id: "all", label: "All" },
  { id: "transactions", label: "Transactions" },
  { id: "payroll", label: "Payroll" },
  { id: "security", label: "Security" },
  { id: "promotions", label: "Promotions" },
] as const;

type FilterTabId = (typeof filterTabs)[number]["id"];

function getNotificationIcon(type: NotificationItem["type"]) {
  switch (type) {
    case "transaction":
      return { icon: ArrowUpRight, bg: "bg-emerald-500/10", color: "text-emerald-600 dark:text-emerald-400" };
    case "payroll":
      return { icon: Building2, bg: "bg-teal-500/10", color: "text-teal-600 dark:text-teal-400" };
    case "security":
      return { icon: ShieldCheck, bg: "bg-amber-500/10", color: "text-amber-600 dark:text-amber-400" };
    case "promotion":
      return { icon: Megaphone, bg: "bg-emerald-500/10", color: "text-emerald-600 dark:text-emerald-400" };
    case "loan":
      return { icon: CreditCard, bg: "bg-amber-500/10", color: "text-amber-600 dark:text-amber-400" };
    case "savings":
      return { icon: PiggyBank, bg: "bg-teal-500/10", color: "text-teal-600 dark:text-teal-400" };
    case "system":
      return { icon: Settings, bg: "bg-gray-500/10", color: "text-gray-600 dark:text-gray-400" };
    default:
      return { icon: Bell, bg: "bg-muted", color: "text-muted-foreground" };
  }
}

function getPriorityConfig(priority: NotificationItem["priority"]) {
  switch (priority) {
    case "URGENT":
      return { label: "Urgent", bg: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700" };
    case "HIGH":
      return { label: "High", bg: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700" };
    case "MEDIUM":
      return { label: "Medium", bg: "bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700" };
    case "LOW":
      return { label: "Low", bg: "bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-700" };
    default:
      return { label: priority, bg: "bg-muted text-muted-foreground border-muted" };
  }
}

function getChannelIcon(channel: NotificationItem["channel"]) {
  switch (channel) {
    case "PUSH":
      return { icon: Bell, label: "Push" };
    case "IN_APP":
      return { icon: Smartphone, label: "In-App" };
    case "EMAIL":
      return { icon: Mail, label: "Email" };
    case "SMS":
      return { icon: MessageSquare, label: "SMS" };
    default:
      return { icon: Bell, label: channel };
  }
}

function getSubtypeIcon(subtype: string) {
  switch (subtype) {
    case "RECEIVED":
      return ArrowDownLeft;
    case "SENT":
      return ArrowUpRight;
    case "LOGIN":
      return Smartphone;
    case "SALARY":
      return Building2;
    case "SECURITY":
      return Lock;
    case "PROMO":
      return Sparkles;
    case "REMINDER":
      return AlertTriangle;
    case "SAVINGS":
      return PiggyBank;
    case "SYSTEM":
      return Settings;
    case "REMITTANCE":
      return ArrowUpRight;
    default:
      return Bell;
  }
}

function getFilterCount(notifications: NotificationItem[], tabId: FilterTabId): number {
  if (tabId === "all") return notifications.length;
  if (tabId === "transactions") return notifications.filter(n => n.type === "transaction" || n.type === "loan").length;
  if (tabId === "promotions") return notifications.filter(n => n.type === "promotion" || n.type === "savings").length;
  return notifications.filter(n => n.type === tabId).length;
}

// ── Animation Variants ─────────────────────────────────────────────
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

// ── Skeleton Component ──────────────────────────────────────────
function NotificationSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      {/* Filter tabs skeleton */}
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-9 w-20 rounded-lg" />
        ))}
      </div>
      {/* Notification list skeleton */}
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i}>
            <CardContent className="flex items-start gap-3 p-4">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-3 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────
export function NotificationsPage() {
  const [data, setData] = useState<NotificationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterTabId>("all");
  const [settings, setSettings] = useState<NotificationSettings>(mockData.settings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/notifications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      if (json.settings) setSettings(json.settings);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
      toast.error("Could not load notifications. Showing sample data.");
      setData(mockData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const notifications = data?.notifications ?? mockData.notifications;
  const unreadCount = data?.unreadCount ?? mockData.unreadCount;

  const filteredNotifications = notifications.filter((n) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "transactions") return n.type === "transaction" || n.type === "loan";
    if (activeFilter === "promotions") return n.type === "promotion" || n.type === "savings";
    return n.type === activeFilter;
  });

  const handleMarkAllRead = () => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        notifications: prev.notifications.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      };
    });
    toast.success("All notifications marked as read");
  };

  const handleMarkAsRead = (id: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const notification = prev.notifications.find((n) => n.id === id);
      if (!notification || notification.read) return prev;
      return {
        ...prev,
        notifications: prev.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: Math.max(0, prev.unreadCount - 1),
      };
    });
  };

  const updateChannelSetting = (key: keyof NotificationSettings["channels"]) => {
    setSettings((prev) => ({
      ...prev,
      channels: { ...prev.channels, [key]: !prev.channels[key] },
    }));
  };

  const updateTypeSetting = (key: keyof NotificationSettings["types"]) => {
    setSettings((prev) => ({
      ...prev,
      types: { ...prev.types, [key]: !prev.types[key] },
    }));
  };

  if (loading) {
    return (
      <motion.div
        className="space-y-6"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <NotificationSkeleton />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="space-y-6"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/20">
            <Bell className="size-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">{unreadCount} unread</span>
              ) : (
                "All caught up!"
              )}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
            onClick={handleMarkAllRead}
          >
            <CheckCheck className="size-4" /> Mark All Read
          </Button>
        )}
      </motion.div>

      {/* Filter Tabs */}
      <motion.div variants={item}>
        <div className="flex flex-wrap gap-2">
          {filterTabs.map((tab) => {
            const count = getFilterCount(notifications, tab.id);
            const isActive = activeFilter === tab.id;
            return (
              <Button
                key={tab.id}
                size="sm"
                variant={isActive ? "default" : "outline"}
                className={
                  isActive
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "border-border hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-400"
                }
                onClick={() => setActiveFilter(tab.id)}
              >
                {tab.label}
                <Badge
                  variant="secondary"
                  className={`ml-1.5 h-5 min-w-5 px-1.5 text-[10px] ${
                    isActive ? "bg-white/20 text-white border-0" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>
      </motion.div>

      {/* Notification List */}
      <motion.div variants={item}>
        <ScrollArea className="max-h-[600px]">
          <div className="space-y-3 pr-2">
            <AnimatePresence mode="popLayout">
              {filteredNotifications.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex flex-col items-center justify-center gap-3 py-16"
                >
                  <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                    <BellOff className="size-8 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold">No notifications</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {activeFilter === "all"
                        ? "You're all caught up!"
                        : `No ${activeFilter} notifications found`}
                    </p>
                  </div>
                </motion.div>
              ) : (
                filteredNotifications.map((notification) => {
                  const typeIcon = getNotificationIcon(notification.type);
                  const TypeIcon = typeIcon.icon;
                  const subtypeIcon = getSubtypeIcon(notification.subtype);
                  const SubtypeIcon = subtypeIcon;
                  const priorityConfig = getPriorityConfig(notification.priority);
                  const channelInfo = getChannelIcon(notification.channel);
                  const ChannelIcon = channelInfo.icon;

                  return (
                    <motion.div
                      key={notification.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Card
                        className={`transition-shadow hover:shadow-md cursor-pointer ${
                          !notification.read ? "border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/30 dark:bg-emerald-950/10" : ""
                        }`}
                        onClick={() => handleMarkAsRead(notification.id)}
                      >
                        <CardContent className="flex items-start gap-3 p-4">
                          {/* Type Icon */}
                          <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${typeIcon.bg}`}>
                            <TypeIcon className={`size-5 ${typeIcon.color}`} />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {!notification.read && (
                                <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                              )}
                              <p className={`text-sm font-semibold truncate ${!notification.read ? "" : "text-muted-foreground"}`}>
                                {notification.title}
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                              {notification.body}
                            </p>
                            <div className="mt-2 flex items-center gap-3">
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Clock className="size-3" />
                                {notification.time}
                              </span>
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <ChannelIcon className="size-3" />
                                {channelInfo.label}
                              </span>
                            </div>
                          </div>

                          {/* Priority & Status */}
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <Badge variant="outline" className={`text-[10px] border ${priorityConfig.bg}`}>
                              {priorityConfig.label}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] border border-muted text-muted-foreground gap-1">
                              <SubtypeIcon className="size-3" />
                              {notification.subtype}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </motion.div>

      {/* Notification Settings */}
      <motion.div variants={item}>
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings className="size-4 text-emerald-600 dark:text-emerald-400" />
                    <CardTitle className="text-sm font-semibold">Notification Settings</CardTitle>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800">
                    {settingsOpen ? "Hide" : "Customize"}
                  </Badge>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Separator />
              <CardContent className="pt-4 space-y-6">
                {/* Channel toggles */}
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Channels</p>
                  <div className="space-y-3">
                    {[
                      { key: "push" as const, label: "Push Notifications", icon: Bell, desc: "Receive push notifications on your device" },
                      { key: "inApp" as const, label: "In-App", icon: Smartphone, desc: "Show notifications within the app" },
                      { key: "email" as const, label: "Email", icon: Mail, desc: "Receive email notifications" },
                      { key: "sms" as const, label: "SMS", icon: MessageSquare, desc: "Receive SMS notifications" },
                    ].map((channel) => {
                      const Icon = channel.icon;
                      return (
                        <div key={channel.key} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
                              <Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{channel.label}</p>
                              <p className="text-[10px] text-muted-foreground">{channel.desc}</p>
                            </div>
                          </div>
                          <Switch
                            checked={settings.channels[channel.key]}
                            onCheckedChange={() => updateChannelSetting(channel.key)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <Separator />

                {/* Type toggles */}
                <div>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notification Types</p>
                  <div className="space-y-3">
                    {[
                      { key: "transactions" as const, label: "Transactions", icon: ArrowUpRight, desc: "Money sent, received, remittances" },
                      { key: "payroll" as const, label: "Payroll", icon: Building2, desc: "Salary credits, payment schedules" },
                      { key: "security" as const, label: "Security", icon: ShieldCheck, desc: "Login alerts, password changes" },
                      { key: "promotions" as const, label: "Promotions", icon: Megaphone, desc: "Offers, deals, and rewards" },
                      { key: "system" as const, label: "System", icon: Settings, desc: "Maintenance, updates, verifications" },
                    ].map((type) => {
                      const Icon = type.icon;
                      return (
                        <div key={type.key} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10">
                              <Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div>
                              <p className="text-sm font-medium">{type.label}</p>
                              <p className="text-[10px] text-muted-foreground">{type.desc}</p>
                            </div>
                          </div>
                          <Switch
                            checked={settings.types[type.key]}
                            onCheckedChange={() => updateTypeSetting(type.key)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </motion.div>
    </motion.div>
  );
}
