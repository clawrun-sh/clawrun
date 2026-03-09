"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@clawrun/ui/components/ui/button";
import { Badge } from "@clawrun/ui/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@clawrun/ui/components/ui/tooltip";
import { Pause, Play, ArrowDown, Trash2 } from "lucide-react";

interface LogEvent {
  id: string;
  type: string;
  data: unknown;
  timestamp: string;
}

const MAX_EVENTS = 500;

const EVENT_COLORS: Record<string, string> = {
  status: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  heartbeat: "bg-muted text-muted-foreground",
  error: "bg-destructive/10 text-destructive",
};

export default function LogsPage() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const eventBufferRef = useRef<LogEvent[]>([]);

  pausedRef.current = paused;

  useEffect(() => {
    const es = new EventSource("/api/v1/events", { withCredentials: true });

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const logEvent: LogEvent = {
          id: crypto.randomUUID(),
          type: parsed.type ?? "unknown",
          data: parsed.data ?? parsed,
          timestamp: parsed.timestamp ?? new Date().toISOString(),
        };
        if (pausedRef.current) {
          eventBufferRef.current.push(logEvent);
        } else {
          setEvents((prev) => [...prev, logEvent].slice(-MAX_EVENTS));
        }
      } catch {}
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const handleResume = useCallback(() => {
    setPaused(false);
    const buffered = eventBufferRef.current;
    eventBufferRef.current = [];
    if (buffered.length > 0) {
      setEvents((prev) => [...prev, ...buffered].slice(-MAX_EVENTS));
    }
  }, []);

  const handleClear = useCallback(() => {
    setEvents([]);
    eventBufferRef.current = [];
  }, []);

  const filteredEvents = typeFilter ? events.filter((e) => e.type === typeFilter) : events;

  const eventTypes = [...new Set(events.map((e) => e.type))];

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="flex items-center justify-between gap-2 px-4 lg:px-6">
          <div className="flex items-center gap-2">
            <Badge variant={connected ? "default" : "secondary"}>
              {connected ? "Connected" : "Disconnected"}
            </Badge>
            <div className="flex gap-1">
              <Button
                variant={!typeFilter ? "default" : "outline"}
                size="sm"
                onClick={() => setTypeFilter(null)}
              >
                All
              </Button>
              {eventTypes.map((t) => (
                <Button
                  key={t}
                  variant={typeFilter === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTypeFilter(t === typeFilter ? null : t)}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => (paused ? handleResume() : setPaused(true))}
                >
                  {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{paused ? "Resume" : "Pause"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => setAutoScroll(!autoScroll)}>
                  <ArrowDown
                    className={`size-4 ${autoScroll ? "text-foreground" : "text-muted-foreground"}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{autoScroll ? "Auto-scroll on" : "Auto-scroll off"}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleClear}>
                  <Trash2 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear logs</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="flex-1 px-4 lg:px-6">
          <div
            ref={scrollRef}
            className="h-[calc(100vh-14rem)] overflow-auto rounded-lg border bg-muted/30 font-mono text-xs"
          >
            {filteredEvents.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {connected ? "Waiting for events..." : "Connecting..."}
              </div>
            ) : (
              <div className="p-2">
                {filteredEvents.map((event) => (
                  <div
                    key={event.id}
                    className={`flex gap-2 rounded px-2 py-1 ${EVENT_COLORS[event.type] ?? ""}`}
                  >
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {event.type}
                    </Badge>
                    <span className="min-w-0 break-all">
                      {typeof event.data === "string" ? event.data : JSON.stringify(event.data)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {paused && eventBufferRef.current.length > 0 && (
          <div className="text-center text-xs text-muted-foreground">
            {eventBufferRef.current.length} events buffered while paused
          </div>
        )}
      </div>
    </div>
  );
}
