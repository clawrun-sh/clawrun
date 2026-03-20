"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Focus a textarea when the user starts typing anywhere on the page,
 * unless another input/textarea is already focused.
 * Follows the v0/Claude pattern where the chat input captures loose keystrokes.
 */
export function useFocusOnKeydown(ref: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      // Ignore if modifier keys are held (shortcuts)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Ignore non-printable keys
      if (e.key.length !== 1) return;

      // Ignore if an input, textarea, or contenteditable is already focused
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }

      // Focus the textarea — the browser will insert the character naturally
      ref.current?.focus();
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [ref]);
}
