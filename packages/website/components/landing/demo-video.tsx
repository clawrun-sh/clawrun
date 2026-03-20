"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CirclePlay, X } from "lucide-react";
import { YouTube } from "@/components/docs/youtube";

export function DemoVideo() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="mb-6 inline-flex cursor-pointer items-center gap-2 border border-border px-3 py-1.5 text-xs uppercase tracking-[0.1em] text-muted-foreground no-underline transition-colors hover:bg-surface-hover">
          <CirclePlay size={14} className="text-primary" aria-hidden="true" />
          Watch Demo
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 p-4 outline-none">
          <Dialog.Title className="sr-only">ClawRun Demo Video</Dialog.Title>
          <YouTube
            id="huda-Dh0mWc"
            title="ClawRun Demo"
            autoplay
            className="aspect-video w-full overflow-hidden rounded-lg bg-black"
          />
          <Dialog.Close className="absolute -right-2 -top-2 rounded-full bg-black/60 p-1.5 text-white/80 transition-colors hover:text-white">
            <X size={20} />
            <span className="sr-only">Close</span>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
