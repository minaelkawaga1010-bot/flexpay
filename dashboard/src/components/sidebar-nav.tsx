"use client";

import { useEffect } from "react";
import {
  Wallet,
  LayoutDashboard,
  ArrowLeftRight,
  Send,
  CreditCard,
  Users,
  TrendingUp,
  Award,
  Shield,
  ChevronRight,
  Mic,
  Server,
  PiggyBank,
  Banknote,
  UserPlus,
  Bell,
  Tag,
  Activity,
  GitBranch,
  Cloud,
  Briefcase,
  Network,
  Braces,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/store/app-store";
import { useIsMobile } from "@/hooks/use-mobile";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "send", label: "Send & Remit", icon: Send },
  { id: "cards", label: "Cards", icon: CreditCard },
  { id: "hafiza", label: "Hafiza Savings", icon: Users },
  { id: "credit-score", label: "Credit Score", icon: TrendingUp },
  { id: "savings", label: "Savings Goals", icon: PiggyBank },
  { id: "loyalty", label: "Loyalty", icon: Award },
  { id: "loans", label: "Loans & EWA", icon: Banknote },
  { id: "referrals", label: "Referrals", icon: UserPlus },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "offers", label: "Offers & Cashback", icon: Tag },
  { id: "compliance", label: "Compliance", icon: Shield },
  { id: "voice-ai", label: "Voice Assistant", icon: Mic },
  { id: "architecture", label: "Backend Architecture", icon: Server },
  { id: "sre-observability", label: "SRE & Observability", icon: Activity },
  { id: "cicd-pipeline", label: "CI/CD Pipeline", icon: GitBranch },
  { id: "infrastructure", label: "Infrastructure", icon: Cloud },
  { id: "board-deck", label: "Board Report", icon: Briefcase },
  { id: "system-architecture", label: "System Architecture", icon: Network },
  { id: "backend-engineering", label: "Backend Engineering", icon: Braces },
];

export function SidebarNav() {
  const { activeTab, setActiveTab, user, isMobileSidebarOpen, setMobileSidebarOpen } =
    useAppStore();
  const isMobile = useIsMobile();

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    window.history.replaceState(null, "", `#${tabId}`);
    if (isMobile) {
      setMobileSidebarOpen(false);
    }
  };

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash && navItems.some((item) => item.id === hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    // Set initial tab from hash
    const initialHash = window.location.hash.replace("#", "");
    if (initialHash) {
      setActiveTab(initialHash);
    } else {
      setActiveTab("backend-engineering");
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [setActiveTab]);

  return (
    <div className="flex h-full flex-col">
      {/* Logo Area */}
      <div className="flex flex-col items-center gap-1 px-4 pt-6 pb-4">
        <div className="flex items-center gap-2.5">
          <img
            src="/flexpay-logo.png"
            alt="FlexPay"
            className="size-9 rounded-lg object-contain"
          />
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-white">
              Flex<span className="text-emerald-400">Pay</span>
            </span>
            <span className="text-[10px] font-medium tracking-widest text-emerald-400/60 uppercase">
              Digital Wallet Platform
            </span>
          </div>
        </div>
      </div>

      <Separator className="bg-sidebar-border mx-3 w-auto" />

      {/* Navigation */}
      <ScrollArea className="sidebar-scroll flex-1 px-2 py-3">
        <nav className="flex flex-col gap-0.5" role="navigation" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                  isActive
                    ? "bg-emerald-500/15 text-emerald-400 brand-glow"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon
                  className={`size-[18px] shrink-0 transition-colors duration-200 ${
                    isActive
                      ? "text-emerald-400"
                      : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80"
                  }`}
                />
                <span className="truncate">{item.label}</span>
                {isActive && (
                  <ChevronRight className="ml-auto size-3.5 text-emerald-400/70" />
                )}
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-sidebar-border mx-3 w-auto" />

      {/* User Area */}
      <div className="flex items-center gap-3 px-4 py-4">
        <Avatar className="size-9 ring-2 ring-emerald-500/30">
          <AvatarFallback className="bg-emerald-500/20 text-xs font-semibold text-emerald-400">
            RK
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold text-white">
            {user?.fullName ?? "Rajesh Kumar"}
          </span>
          <div className="flex items-center gap-1.5">
            <Badge className="h-5 rounded-md bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-400 border-0">
              Employee
            </Badge>
            <span className="text-[10px] text-sidebar-foreground/50">
              KYC Level {user?.kycLevel ?? 2}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
