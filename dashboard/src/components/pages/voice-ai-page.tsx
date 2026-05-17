"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  Send,
  Brain,
  Wallet,
  ArrowLeftRight,
  TrendingUp,
  Check,
  Volume2,
  Settings,
  Globe,
  Languages,
  Zap,
  Shield,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ───────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  audioUrl?: string;
}

// ── Mock AI Responses ───────────────────────────────────────────────
function getMockResponse(query: string): string {
  const lower = query.toLowerCase();
  if (lower.includes("balance") || lower.includes("wallet")) {
    return "Your current balance is AED 12,500.00. This includes AED 8,500 in your main wallet, AED 2,820 in INR, and AED 1,180 in PHP.";
  }
  if (lower.includes("send") || lower.includes("transfer") || lower.includes("remit")) {
    return "I can help you send money! You can send to saved beneficiaries or enter a new phone number. Who would you like to send to?";
  }
  if (
    lower.includes("transaction") ||
    lower.includes("recent") ||
    lower.includes("history")
  ) {
    return "You have 24 transactions this month. Your recent transactions include: Salary Credit of AED 8,500 on Dec 1, and a transfer to Amit of AED 500 yesterday.";
  }
  if (lower.includes("credit") || lower.includes("score")) {
    return "Your AI credit score is 78 out of 100 (Good). Your score increased by 5 points this month. Keep making timely payments to improve it further!";
  }
  return "I'm your FlexPay AI assistant. I can help you check your balance, send money, view transactions, check your credit score, and more. What would you like to do?";
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

// ── Quick Actions ──────────────────────────────────────────────────
const quickActions = [
  { id: "balance", label: "Check Balance", icon: Wallet, query: "Check my wallet balance" },
  { id: "send", label: "Send Money", icon: Send, query: "I want to send money" },
  { id: "transactions", label: "Recent Transactions", icon: ArrowLeftRight, query: "Show my recent transactions" },
  { id: "credit", label: "Credit Score", icon: TrendingUp, query: "Check my credit score" },
];

// ── How It Works Steps ─────────────────────────────────────────────
const howItWorks = [
  { step: 1, title: "Speak", description: "Tap the mic and ask in your language", icon: Mic },
  { step: 2, title: "AI Understands", description: "Our AI processes your request instantly", icon: Brain },
  { step: 3, title: "Get Results", description: "Receive accurate responses with actions", icon: Check },
];

// ── Voice Speeds ───────────────────────────────────────────────────
const voiceSpeeds = [
  { label: "0.8x", value: 0.8 },
  { label: "1.0x", value: 1.0 },
  { label: "1.2x", value: 1.2 },
];

// ── Format Timestamp ───────────────────────────────────────────────
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Format Duration ────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ── Main Page ──────────────────────────────────────────────────────
export function VoiceAIPage() {
  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);
  const [waveformHeights, setWaveformHeights] = useState<number[]>([40, 40, 40, 40, 40]);

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const startTimeRef = useRef<number>(0);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  // Waveform animation while recording
  useEffect(() => {
    if (!isRecording) return;

    const animate = () => {
      setWaveformHeights(
        Array.from({ length: 5 }, () => 20 + Math.random() * 60)
      );
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setWaveformHeights([40, 40, 40, 40, 40]);
    };
  }, [isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // ── Send Text Message ──────────────────────────────────────────
  const handleSendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setTextInput("");
      setIsProcessing(true);

      try {
        const res = await fetch("/api/voice/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, language: selectedLanguage }),
        });
        const data = await res.json();

        const aiMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.response || getMockResponse(trimmed),
          timestamp: new Date(),
          audioUrl: data.audioBase64
            ? `data:audio/wav;base64,${data.audioBase64}`
            : undefined,
        };
        setMessages((prev) => [...prev, aiMsg]);

        if (data.audioBase64) {
          const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
          audio.playbackRate = voiceSpeed;
          audio.play().catch(() => {});
        }
      } catch {
        const mockResponse = getMockResponse(trimmed);
        const aiMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: mockResponse,
          timestamp: new Date(),
        };
        setTimeout(() => {
          setMessages((prev) => [...prev, aiMsg]);
          setIsProcessing(false);
        }, 800);
        return;
      }

      setIsProcessing(false);
    },
    [selectedLanguage, voiceSpeed]
  );

  // ── Process Audio Blob ─────────────────────────────────────────
  const processAudioBlob = useCallback(async (blob: Blob) => {
    // Convert blob to base64
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const base64Audio = (reader.result as string).split(",")[1];

      // Add user message placeholder (transcription will come from API)
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: "🎤 Voice message",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsProcessing(true);

      try {
        const res = await fetch("/api/voice/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64: base64Audio, language: selectedLanguage }),
        });
        const data = await res.json();

        // Update user message with actual transcription
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id ? { ...m, content: data.transcription || "Voice message" } : m
          )
        );

        // Add AI response
        const aiMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.response || getMockResponse(""),
          timestamp: new Date(),
          audioUrl: data.audioBase64
            ? `data:audio/wav;base64,${data.audioBase64}`
            : undefined,
        };
        setMessages((prev) => [...prev, aiMsg]);

        // Play TTS audio if returned
        if (data.audioBase64) {
          const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
          audio.playbackRate = voiceSpeed;
          audio.play().catch(() => {});
        }
      } catch {
        // Mock fallback
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMsg.id
              ? { ...m, content: "Check my wallet balance" }
              : m
          )
        );

        const mockResponse = getMockResponse("balance");
        const aiMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: mockResponse,
          timestamp: new Date(),
        };
        setTimeout(() => {
          setMessages((prev) => [...prev, aiMsg]);
          setIsProcessing(false);
        }, 1000);
        return;
      }

      setIsProcessing(false);
    };
  }, [selectedLanguage, voiceSpeed]);

  // ── Recording Functions ────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Set up analyser for waveform visualization
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;

      const chunks: BlobPart[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        await processAudioBlob(blob);

        // Clean up stream
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      startTimeRef.current = Date.now();

      // Timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((Date.now() - startTimeRef.current) / 1000);
      }, 100);
    } catch {
      // Fallback: if mic access denied, add a mock user message
      handleSendText("Hello, I need help with my account");
    }
  }, [processAudioBlob, handleSendText]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  }, [isRecording]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // ── Quick Action Handler ───────────────────────────────────────
  const handleQuickAction = useCallback(
    (query: string) => {
      handleSendText(query);
    },
    [handleSendText]
  );

  // ── Replay TTS ─────────────────────────────────────────────────
  const replayAudio = useCallback(
    (msg: ChatMessage) => {
      if (msg.audioUrl) {
        const audio = new Audio(msg.audioUrl);
        audio.playbackRate = voiceSpeed;
        audio.play().catch(() => {});
      } else {
        // Use browser SpeechSynthesis as fallback
        if ("speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(msg.content);
          utterance.rate = voiceSpeed;
          window.speechSynthesis.speak(utterance);
        }
      }
    },
    [voiceSpeed]
  );

  // ── Handle Text Input Submit ───────────────────────────────────
  const handleTextSubmit = useCallback(() => {
    if (textInput.trim()) {
      handleSendText(textInput);
    }
  }, [textInput, handleSendText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleTextSubmit();
      }
    },
    [handleTextSubmit]
  );

  return (
    <motion.div
      className="flex min-h-0 flex-col gap-6"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* ── 1. Hero Header ──────────────────────────────────────── */}
      <motion.div variants={item}>
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700 dark:from-emerald-700 dark:via-emerald-700 dark:to-teal-800">
          {/* Decorative circles */}
          <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/5" />
          <div className="pointer-events-none absolute -bottom-6 -left-6 size-28 rounded-full bg-white/5" />

          <CardContent className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
            {/* Left: Icon + Title */}
            <div className="flex items-center gap-4">
              <div
                className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm ${
                  isRecording ? "animate-pulse" : ""
                }`}
              >
                <Mic className="size-7 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                  Voice Assistant
                </h1>
                <p className="mt-0.5 text-sm text-emerald-100/80">
                  Speak in your language, we understand
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge className="border-0 bg-white/15 text-[11px] font-medium text-white backdrop-blur-sm">
                    <Zap className="mr-1 size-3" />
                    AI Powered
                  </Badge>
                  <Badge className="border-0 bg-white/15 text-[11px] font-medium text-white backdrop-blur-sm">
                    <Languages className="mr-1 size-3" />
                    Multi-Language
                  </Badge>
                  <Badge className="border-0 bg-white/15 text-[11px] font-medium text-white backdrop-blur-sm">
                    <Shield className="mr-1 size-3" />
                    Secure
                  </Badge>
                </div>
              </div>
            </div>

            {/* Right: Language Selector */}
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-emerald-100/60" />
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                <SelectTrigger className="h-9 w-[160px] border-white/20 bg-white/10 text-sm text-white backdrop-blur-sm focus:ring-white/30">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية (Arabic)</SelectItem>
                  <SelectItem value="hi">हिन्दी (Hindi)</SelectItem>
                  <SelectItem value="ur">اردو (Urdu)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── 2. Chat Conversation Area ───────────────────────────── */}
      <motion.div
        variants={item}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
      >
        {/* Chat Messages */}
        <div className="chat-scroll flex-1 overflow-y-auto p-4" style={{ maxHeight: 500 }}>
          {messages.length === 0 && !isProcessing ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <Mic className="size-7 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Tap the microphone and speak, or type your message below
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  AI assistant is ready to help you with your FlexPay account
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className={`flex gap-2.5 ${
                      msg.role === "user" ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {/* Avatar */}
                    <div
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        msg.role === "user"
                          ? "bg-emerald-600 text-white"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      }`}
                    >
                      {msg.role === "user" ? "RK" : <Brain className="size-4" />}
                    </div>

                    {/* Message Bubble */}
                    <div
                      className={`relative max-w-[80%] rounded-2xl px-4 py-2.5 sm:max-w-[70%] ${
                        msg.role === "user"
                          ? "rounded-tr-sm bg-emerald-600 text-white"
                          : "rounded-tl-sm bg-muted text-foreground"
                      }`}
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      <div
                        className={`mt-1.5 flex items-center gap-1.5 ${
                          msg.role === "user" ? "justify-end" : "justify-start"
                        }`}
                      >
                        <span
                          className={`text-[10px] ${
                            msg.role === "user"
                              ? "text-emerald-200/70"
                              : "text-muted-foreground/60"
                          }`}
                        >
                          {formatTime(msg.timestamp)}
                        </span>
                        {msg.role === "assistant" && (
                          <button
                            onClick={() => replayAudio(msg)}
                            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                            aria-label="Replay audio"
                          >
                            {/* msg.role is narrowed to "assistant" inside this block. */}
                            <Volume2 className="size-3 text-muted-foreground/50" />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Typing Indicator */}
              <AnimatePresence>
                {isProcessing && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="flex gap-2.5"
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      <Brain className="size-4" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span className="typing-dot size-2 rounded-full bg-muted-foreground/40" />
                        <span className="typing-dot size-2 rounded-full bg-muted-foreground/40 [animation-delay:0.15s]" />
                        <span className="typing-dot size-2 rounded-full bg-muted-foreground/40 [animation-delay:0.3s]" />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ── 3. Input Area (Fixed to bottom) ────────────────────── */}
        <div className="border-t bg-card p-3">
          {/* Recording State: Waveform + Timer */}
          <AnimatePresence>
            {isRecording && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-3 flex items-center justify-center gap-4 overflow-hidden"
              >
                <div className="flex items-center gap-1.5">
                  {waveformHeights.map((h, i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 rounded-full bg-emerald-500"
                      animate={{ height: `${h}%` }}
                      transition={{ duration: 0.15 }}
                      style={{ height: `${h}%`, maxHeight: 32, minHeight: 8 }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1">
                  <div className="size-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs font-mono font-semibold text-red-600 dark:text-red-400">
                    REC {formatDuration(recordingDuration)}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2.5">
            {/* Text Input */}
            <div className="relative flex-1">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                disabled={isRecording || isProcessing}
                className="h-11 w-full rounded-xl border border-input bg-muted/50 pl-4 pr-11 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 disabled:opacity-50"
              />
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1/2 size-8 -translate-y-1/2 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                onClick={handleTextSubmit}
                disabled={!textInput.trim() || isProcessing || isRecording}
              >
                <Send className="size-4" />
              </Button>
            </div>

            {/* Mic Button */}
            <div className="relative">
              <button
                onClick={toggleRecording}
                disabled={isProcessing}
                className={`relative flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg transition-all hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed ${
                  isRecording ? "scale-105" : "hover:scale-105"
                }`}
                aria-label={isRecording ? "Stop recording" : "Start recording"}
              >
                {isRecording ? (
                  <MicOff className="size-6" />
                ) : (
                  <Mic className="size-6" />
                )}

                {/* Pulsing ring when recording */}
                {isRecording && (
                  <>
                    <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-20" />
                    <span className="absolute -inset-1 rounded-full border-2 border-red-400/30 animate-pulse" />
                  </>
                )}
              </button>
            </div>

            {/* Voice Speed Settings */}
            <div className="relative">
              <Button
                size="icon"
                variant="outline"
                className="size-11 rounded-xl border-border text-muted-foreground hover:text-emerald-600"
                onClick={() => setShowSpeedPicker(!showSpeedPicker)}
                aria-label="Voice settings"
              >
                <Settings className="size-4" />
              </Button>

              {/* Speed Picker Dropdown */}
              <AnimatePresence>
                {showSpeedPicker && (
                  <motion.div
                    initial={{ opacity: 0, y: -5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -5, scale: 0.95 }}
                    className="absolute bottom-14 right-0 z-50 w-32 rounded-xl border bg-popover p-1.5 shadow-lg"
                  >
                    <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Voice Speed
                    </p>
                    {voiceSpeeds.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => {
                          setVoiceSpeed(s.value);
                          setShowSpeedPicker(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                          voiceSpeed === s.value
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        {voiceSpeed === s.value && (
                          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <span className={voiceSpeed !== s.value ? "ml-[22px]" : ""}>
                          {s.label}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── 4. Quick Actions Grid ───────────────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <motion.button
                key={action.id}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => handleQuickAction(action.query)}
                className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center transition-shadow hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-800/50"
              >
                <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 transition-colors group-hover:bg-emerald-500/20">
                  <Icon className="size-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <span className="text-xs font-medium text-foreground">{action.label}</span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* ── 5. How It Works Section ─────────────────────────────── */}
      <motion.div variants={item}>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">How It Works</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {howItWorks.map((step) => {
            const Icon = step.icon;
            return (
              <Card
                key={step.step}
                className="relative overflow-hidden transition-shadow hover:shadow-md"
              >
                <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
                  {/* Step watermark */}
                  <span className="absolute right-2 top-1 text-5xl font-black text-muted-foreground/5 select-none">
                    {step.step}
                  </span>
                  <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10">
                    <Icon className="size-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
