"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Calendar,
  Gift,
  Star,
  ChevronRight,
  Plus,
  Share2,
  CheckCircle2,
  CircleDot,
  Clock,
  Shield,
  ArrowRight,
  UserPlus,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────
interface ApiMember {
  id: string;
  circleId: string;
  userId: string;
  turnOrder: number;
  trustScore: number;
  hasPaid: boolean;
  user: {
    id: string;
    fullName: string;
    avatarUrl: string | null;
  };
}

interface MyMembership {
  turnOrder: number;
  trustScore: number;
  hasPaid: boolean;
}

interface CurrentTurnMember {
  userId: string;
  fullName: string;
  hasPaid: boolean;
}

interface ApiCircle {
  id: string;
  name: string;
  description: string | null;
  monthlyAmount: number;
  totalMembers: number;
  currentTurn: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  members: ApiMember[];
  myMembership: MyMembership;
  currentTurnMember: CurrentTurnMember | null;
  membersCount: number;
}

// UI-facing member shape
interface Member {
  name: string;
  initials: string;
  turnOrder: number;
  trustScore: number;
  hasPaid: boolean;
}

// UI-facing circle shape
interface Circle {
  id: string;
  name: string;
  memberCount: number;
  maxMembers: number;
  monthlyAmount: number;
  currentTurn: number;
  totalTurns: number;
  trustScore: number;
  members: Member[];
  myTurnToPay: boolean;
  description: string;
  currentTurnMemberName: string | null;
}

// ── Mock Data (fallback) ─────────────────────────────────────────
const mockApiCircles: Circle[] = [
  {
    id: "1",
    name: "Dubai Expats Savings",
    memberCount: 5,
    maxMembers: 5,
    monthlyAmount: 2000,
    currentTurn: 2,
    totalTurns: 5,
    trustScore: 4.8,
    description: "Monthly savings circle for Dubai expat community",
    myTurnToPay: true,
    currentTurnMemberName: "Rajesh Kumar",
    members: [
      { name: "Ahmed Ali", initials: "AA", turnOrder: 1, trustScore: 5, hasPaid: true },
      { name: "Rajesh Kumar", initials: "RK", turnOrder: 2, trustScore: 5, hasPaid: false },
      { name: "Maria Santos", initials: "MS", turnOrder: 3, trustScore: 4.5, hasPaid: false },
      { name: "John Osei", initials: "JO", turnOrder: 4, trustScore: 5, hasPaid: false },
      { name: "Fatima Hassan", initials: "FH", turnOrder: 5, trustScore: 4, hasPaid: false },
    ],
  },
  {
    id: "2",
    name: "Office Friends Fund",
    memberCount: 4,
    maxMembers: 8,
    monthlyAmount: 1000,
    currentTurn: 3,
    totalTurns: 4,
    trustScore: 4.5,
    description: "Colleague savings group for emergency fund",
    myTurnToPay: false,
    currentTurnMemberName: "Priya Sharma",
    members: [
      { name: "Rajesh Kumar", initials: "RK", turnOrder: 1, trustScore: 5, hasPaid: true },
      { name: "Sunita Devi", initials: "SD", turnOrder: 2, trustScore: 5, hasPaid: true },
      { name: "Priya Sharma", initials: "PS", turnOrder: 3, trustScore: 4.5, hasPaid: true },
      { name: "Vikram Patel", initials: "VP", turnOrder: 4, trustScore: 4, hasPaid: false },
    ],
  },
];

const mockPaymentHistory = [
  { month: "Jan 2025", amount: 2000, status: "Paid", date: "Jan 5, 2025" },
  { month: "Dec 2024", amount: 2000, status: "Paid", date: "Dec 5, 2024" },
  { month: "Nov 2024", amount: 2000, status: "Paid", date: "Nov 5, 2024" },
  { month: "Oct 2024", amount: 2000, status: "Paid", date: "Oct 5, 2024" },
];

const avatarColors = [
  "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400",
  "bg-teal-500/20 text-teal-700 dark:text-teal-400",
  "bg-cyan-500/20 text-cyan-700 dark:text-cyan-400",
  "bg-emerald-600/20 text-emerald-800 dark:text-emerald-300",
  "bg-teal-600/20 text-teal-800 dark:text-teal-300",
];

// ── Helpers ──────────────────────────────────────────────────────
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function mapApiToCircle(api: ApiCircle): Circle {
  const members: Member[] = api.members.map((m) => ({
    name: m.user.fullName,
    initials: getInitials(m.user.fullName),
    turnOrder: m.turnOrder,
    trustScore: Math.min(5, Math.round(m.trustScore / 20)),
    hasPaid: m.hasPaid,
  }));

  // Average trust score across all members
  const avgTrust =
    members.length > 0
      ? members.reduce((sum, m) => sum + m.trustScore, 0) / members.length
      : 5;

  const isMyTurn =
    api.myMembership.turnOrder === api.currentTurn && !api.myMembership.hasPaid;

  return {
    id: api.id,
    name: api.name,
    memberCount: api.membersCount,
    maxMembers: Math.max(api.totalMembers, api.membersCount),
    monthlyAmount: api.monthlyAmount,
    currentTurn: api.currentTurn,
    totalTurns: api.membersCount,
    trustScore: parseFloat(avgTrust.toFixed(1)),
    members,
    myTurnToPay: isMyTurn,
    description: api.description ?? "",
    currentTurnMemberName: api.currentTurnMember?.fullName ?? null,
  };
}

// ── Animation Variants ───────────────────────────────────────────
const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

// ── Components ───────────────────────────────────────────────────
function StarRating({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`size-3.5 ${
            star <= Math.round(score)
              ? "fill-amber-400 text-amber-400"
              : "fill-muted text-muted"
          }`}
        />
      ))}
      <span className="ml-1 text-xs font-medium text-muted-foreground">{score}</span>
    </div>
  );
}

function MemberAvatars({ members }: { members: Member[] }) {
  return (
    <div className="flex items-center -space-x-2">
      {members.slice(0, 5).map((m, i) => (
        <Avatar
          key={m.initials + m.turnOrder}
          className="size-8 ring-2 ring-background"
          title={m.name}
        >
          <AvatarFallback
            className={`text-[10px] font-semibold ${avatarColors[i % avatarColors.length]}`}
          >
            {m.initials}
          </AvatarFallback>
        </Avatar>
      ))}
      {members.length > 5 && (
        <div className="flex size-8 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-background">
          +{members.length - 5}
        </div>
      )}
    </div>
  );
}

// ── Loading Skeleton ─────────────────────────────────────────────
function CircleCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex -space-x-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="size-8 rounded-full ring-2 ring-background" />
            ))}
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-2 w-full" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Circle Detail Dialog ─────────────────────────────────────────
function CircleDetailDialog({ circle }: { circle: Circle }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-xs text-emerald-600 hover:text-emerald-700">
          View Details <ChevronRight className="size-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5 text-emerald-500" />
            {circle.name}
          </DialogTitle>
          <DialogDescription>{circle.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-lg font-bold text-foreground">AED {circle.monthlyAmount.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">Monthly</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-lg font-bold text-foreground">{circle.memberCount}/{circle.maxMembers}</p>
              <p className="text-[10px] text-muted-foreground">Members</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-lg font-bold text-foreground">Turn {circle.currentTurn + 1}</p>
              <p className="text-[10px] text-muted-foreground">of {circle.totalTurns}</p>
            </div>
          </div>

          {/* Current Turn Indicator */}
          {circle.currentTurnMemberName && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2 dark:border-emerald-800/50 dark:bg-emerald-950/20">
              <CircleDot className="size-4 text-emerald-500" />
              <span className="text-xs">
                <span className="font-semibold">{circle.currentTurnMemberName}</span>
                {" 's turn to receive"}
              </span>
            </div>
          )}

          <Separator />

          {/* Member List */}
          <div>
            <h4 className="mb-2 text-sm font-semibold">Turn Order</h4>
            <div className="space-y-2">
              {circle.members.map((member) => {
                const isCurrentTurn = member.turnOrder === circle.currentTurn;
                return (
                  <div
                    key={member.turnOrder}
                    className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                      isCurrentTurn
                        ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-700/50 dark:bg-emerald-950/20"
                        : ""
                    }`}
                  >
                    <div className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-bold">
                      {member.turnOrder + 1}
                    </div>
                    <Avatar className="size-7">
                      <AvatarFallback className="text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                        {member.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{member.name}</p>
                      <div className="flex items-center gap-2">
                        <StarRating score={member.trustScore} />
                        {member.hasPaid && (
                          <CheckCircle2 className="size-3 text-emerald-500" />
                        )}
                      </div>
                    </div>
                    {isCurrentTurn && (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px]">
                        <CircleDot className="mr-1 size-3" /> Current
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Payment History (static mock) */}
          <div>
            <h4 className="mb-2 text-sm font-semibold">Payment History</h4>
            <div className="space-y-2">
              {mockPaymentHistory.map((p) => (
                <div key={p.month} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{p.month}</p>
                    <p className="text-[10px] text-muted-foreground">{p.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">AED {p.amount.toLocaleString()}</p>
                    <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400">
                      {p.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              className="flex-1 gap-2"
              onClick={() => {
                const shareText = `Join my Hafiza savings circle "${circle.name}" on FlexPay! Save together, receive together.`;
                if (navigator.share) {
                  navigator.share({ title: "FlexPay Hafiza", text: shareText });
                } else {
                  navigator.clipboard.writeText(shareText);
                  toast.success("Invite link copied to clipboard!");
                }
              }}
            >
              <Share2 className="size-4" /> Invite Friends
            </Button>
            <Button variant="outline" className="gap-2">
              <Shield className="size-4" /> Circle Rules
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Circle Dialog ─────────────────────────────────────────
function CreateCircleDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [maxMembers, setMaxMembers] = useState("");

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Please enter a circle name");
      return;
    }
    const amount = parseFloat(monthlyAmount);
    if (!amount || amount <= 0) {
      toast.error("Please enter a valid monthly amount");
      return;
    }
    const max = parseInt(maxMembers);
    if (!max || max < 2) {
      toast.error("Max members must be at least 2");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/hafiza", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          monthlyAmount: amount,
          maxMembers: max,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to create circle" }));
        throw new Error(err.error || "Failed to create circle");
      }

      toast.success("Circle created successfully! Share the invite link with your friends.");
      setOpen(false);
      setName("");
      setDescription("");
      setMonthlyAmount("");
      setMaxMembers("");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create circle");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" /> Create Circle
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-emerald-500" />
            Create New Circle
          </DialogTitle>
          <DialogDescription>
            Start a new Hafiza savings circle with friends or colleagues.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="circle-name">Circle Name</Label>
            <Input
              id="circle-name"
              placeholder="e.g., Family Savings Group"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="circle-desc">Description</Label>
            <Input
              id="circle-desc"
              placeholder="What is this circle for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="monthly-amount">Monthly Amount (AED)</Label>
              <Input
                id="monthly-amount"
                type="number"
                placeholder="1000"
                value={monthlyAmount}
                onChange={(e) => setMonthlyAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-members">Max Members</Label>
              <Input
                id="max-members"
                type="number"
                placeholder="5"
                min={2}
                max={20}
                value={maxMembers}
                onChange={(e) => setMaxMembers(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isCreating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create Circle"
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export function HafizaPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payingCircleId, setPayingCircleId] = useState<string | null>(null);

  const fetchCircles = useCallback(async () => {
    try {
      const res = await fetch("/api/hafiza");
      if (!res.ok) throw new Error("Failed to fetch circles");

      const data = await res.json();
      const apiCircles: ApiCircle[] = data.circles ?? [];
      if (apiCircles.length > 0) {
        setCircles(apiCircles.map(mapApiToCircle));
        setError(null);
      } else {
        // No circles from API — use mock as fallback
        setCircles(mockApiCircles);
        setError(null);
      }
    } catch (err) {
      console.error("Failed to fetch hafiza circles, using mock fallback:", err);
      setCircles(mockApiCircles);
      setError("Showing demo data — backend unavailable");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCircles();
  }, [fetchCircles]);

  async function handlePay(circleId: string, monthlyAmount: number) {
    setPayingCircleId(circleId);
    try {
      const res = await fetch(`/api/hafiza/${circleId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Payment failed" }));
        throw new Error(err.error || "Payment failed");
      }

      const data = await res.json();
      toast.success(
        `Payment of AED ${monthlyAmount.toLocaleString()} successful! Next turn: ${data.nextTurnMember?.fullName ?? "—"}.`
      );
      await fetchCircles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payment failed. Please try again.");
    } finally {
      setPayingCircleId(null);
    }
  }

  return (
    <motion.div
      className="space-y-6"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* Hero Section */}
      <motion.div variants={item} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-6 text-white sm:p-8">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -right-10 -top-10 size-60 rounded-full bg-white/20" />
          <div className="absolute -bottom-6 -left-6 size-40 rounded-full bg-white/15" />
        </div>
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              <Users className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold sm:text-3xl">Hafiza - Social Savings</h1>
              <p className="mt-1 text-sm text-emerald-100/80">Save together, receive together</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex -space-x-1.5">
              {["AA", "MS", "JO", "FH"].map((initials) => (
                <div
                  key={initials}
                  className="flex size-8 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold ring-2 ring-emerald-700"
                >
                  {initials}
                </div>
              ))}
            </div>
            <CreateCircleDialog onCreated={fetchCircles} />
          </div>
        </div>
      </motion.div>

      {/* API Error Notice */}
      {error && !isLoading && (
        <motion.div variants={item}>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
            {error}
          </div>
        </motion.div>
      )}

      {/* Active Circles */}
      <motion.div variants={item}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Active Circles</h2>
          {isLoading ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <Badge variant="outline" className="border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400">
              {circles.length} {circles.length === 1 ? "circle" : "circles"}
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <CircleCardSkeleton />
            <CircleCardSkeleton />
          </div>
        ) : circles.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-12">
            <Users className="mb-3 size-10 text-muted-foreground/50" />
            <p className="text-sm font-medium text-muted-foreground">No circles yet</p>
            <p className="mt-1 text-xs text-muted-foreground/70">Create your first savings circle to get started</p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {circles.map((circle) => (
              <Card key={circle.id} className="group relative overflow-hidden transition-shadow hover:shadow-lg">
                {circle.myTurnToPay && (
                  <div className="absolute right-0 top-0 rounded-bl-lg bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-white uppercase tracking-wide">
                    Action Required
                  </div>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                        <Users className="size-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{circle.name}</CardTitle>
                        <CardDescription className="text-xs">
                          AED {circle.monthlyAmount.toLocaleString()}/month
                        </CardDescription>
                      </div>
                    </div>
                    <CircleDetailDialog circle={circle} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Member Avatars */}
                  <div className="flex items-center justify-between">
                    <MemberAvatars members={circle.members} />
                    <span className="text-xs text-muted-foreground">
                      {circle.memberCount} {circle.memberCount === 1 ? "member" : "members"}
                    </span>
                  </div>

                  {/* Current Turn Indicator */}
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                    <CircleDot className="size-4 text-emerald-500" />
                    <span className="text-xs">
                      <span className="font-semibold">
                        {circle.currentTurnMemberName ?? circle.members.find((m) => m.turnOrder === circle.currentTurn)?.name ?? "—"}
                      </span>
                      {" 's turn to receive"}
                    </span>
                  </div>

                  {/* Progress */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Progress</span>
                      <span className="text-xs font-semibold">
                        Turn {circle.currentTurn + 1} of {circle.totalTurns}
                      </span>
                    </div>
                    <Progress
                      value={circle.totalTurns > 0 ? ((circle.currentTurn + 1) / circle.totalTurns) * 100 : 0}
                      className="h-2"
                    />
                  </div>

                  {/* Trust Score & Pay */}
                  <div className="flex items-center justify-between">
                    <StarRating score={circle.trustScore} />
                    {circle.myTurnToPay && (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={payingCircleId === circle.id}
                        onClick={() => handlePay(circle.id, circle.monthlyAmount)}
                      >
                        {payingCircleId === circle.id ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            Paying…
                          </>
                        ) : (
                          <>
                            <Clock className="size-3.5" /> Pay Now
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </motion.div>

      {/* How It Works */}
      <motion.div variants={item}>
        <h2 className="mb-4 text-lg font-semibold">How It Works</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: Users,
              step: 1,
              title: "Create or Join a Circle",
              description: "Start a new savings circle with friends or join an existing one. Set your monthly contribution amount.",
            },
            {
              icon: Calendar,
              step: 2,
              title: "Contribute Monthly",
              description: "Pay your monthly contribution on time. Each member takes turns receiving the full pool amount.",
            },
            {
              icon: Gift,
              step: 3,
              title: "Take Your Turn",
              description: "When it's your turn, receive the full pooled savings. Build trust and save together as a community.",
            },
          ].map((step) => {
            const Icon = step.icon;
            return (
              <Card key={step.step} className="relative overflow-hidden transition-shadow hover:shadow-md">
                <div className="absolute left-4 top-4 text-3xl font-black text-emerald-100 dark:text-emerald-900/50">
                  {step.step}
                </div>
                <CardContent className="relative flex flex-col items-center gap-3 p-6 pt-8 text-center">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10">
                    <Icon className="size-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  {step.step < 3 && (
                    <ArrowRight className="absolute -right-3 top-1/2 hidden size-5 text-emerald-300 sm:block" />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
