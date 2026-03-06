import {
  TUI,
  ProcessTerminal,
  Container,
  TruncatedText,
  Editor,
  Markdown,
  Spacer,
  Image,
  CancellableLoader,
  CombinedAutocompleteProvider,
  matchesKey,
  Key,
  getCapabilities,
  getImageDimensions,
  imageFallback,
} from "@mariozechner/pi-tui";
import { randomUUID } from "node:crypto";
import type { ClawRunInstance } from "@clawrun/sdk";
import { editorTheme, markdownTheme, userMessageStyle, colors } from "./theme.js";

// ---------------------------------------------------------------------------
// Image extraction from markdown data URIs
// ---------------------------------------------------------------------------

const DATA_URI_IMAGE_RE =
  /!\[([^\]]*)\]\((data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\s]+))\)/g;

interface ExtractedImage {
  alt: string;
  mimeType: string;
  base64: string;
}

/**
 * Extract `![alt](data:image/…;base64,…)` blocks from markdown text.
 * Returns the remaining text (images replaced with alt-text placeholders)
 * and an array of extracted image payloads.
 */
function extractImages(text: string): {
  text: string;
  images: ExtractedImage[];
} {
  const images: ExtractedImage[] = [];
  const cleaned = text.replace(DATA_URI_IMAGE_RE, (_match, alt, _uri, type, b64) => {
    images.push({
      alt: alt || "image",
      mimeType: `image/${type}`,
      base64: (b64 as string).replace(/\s/g, ""),
    });
    return alt ? `[${alt}]` : "";
  });
  return { text: cleaned, images };
}

// ---------------------------------------------------------------------------
// Tool call formatting
// ---------------------------------------------------------------------------

function formatToolArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
}

// ---------------------------------------------------------------------------
// Chat TUI
// ---------------------------------------------------------------------------

/**
 * Launch the pi-tui chat interface for an interactive agent session.
 *
 * Layout (top → bottom):
 *   TruncatedText header
 *   Container     chatContainer   — per-turn: Spacer + Markdown (user card / agent plain)
 *   Container     statusContainer — CancellableLoader while awaiting response
 *   Editor        editor          — bordered input with ❯ prompt in top border, autocomplete + history
 *   TruncatedText footer          — keybinding hints
 */
export async function startChatTUI(
  instanceName: string,
  instance: ClawRunInstance,
  sandboxId: string,
  opts?: { initialMessage?: string },
): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const sessionId = randomUUID().replaceAll("-", "_");

  // --- header ---------------------------------------------------------------
  const header = new TruncatedText(colors.accent(instanceName) + colors.dim(` · ${sandboxId}`));
  tui.addChild(header);

  // --- chat container -------------------------------------------------------
  const chatContainer = new Container();
  tui.addChild(chatContainer);

  // --- status container (loader lives here during requests) -----------------
  const statusContainer = new Container();
  tui.addChild(statusContainer);

  // --- editor ---------------------------------------------------------------
  const editor = new Editor(tui, editorTheme, { paddingX: 2 });
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      [
        { name: "clear", description: "Clear chat history" },
        { name: "exit", description: "Exit the chat" },
      ],
      process.cwd(),
    ),
  );

  // Render ❯ prompt inside the editor's left padding on the first content line
  const editorRender = editor.render.bind(editor);
  (editor as unknown as { render: (width: number) => string[] }).render = (
    width: number,
  ): string[] => {
    const lines = editorRender(width);
    // lines[0] = top border, lines[1] = first content line
    if (lines.length > 1) {
      // paddingX: 2 means the first 2 chars are spaces — replace with "❯ "
      lines[1] = colors.accent("❯") + " " + lines[1].slice(2);
    }
    return lines;
  };

  tui.addChild(editor);
  tui.setFocus(editor);

  // --- footer ---------------------------------------------------------------
  const footer = new TruncatedText(
    colors.dim(
      "Enter send · Alt+Enter newline · Esc cancel · Tab complete · /commands · Ctrl+C exit",
    ),
  );
  tui.addChild(footer);

  // --- state ----------------------------------------------------------------
  let isResponding = false;

  let resolveExit: () => void;
  const exitPromise = new Promise<void>((r) => {
    resolveExit = r;
  });

  function cleanup() {
    tui.stop();
    resolveExit!();
  }

  // Ctrl+C — exit
  tui.addInputListener((data) => {
    if (matchesKey(data, Key.ctrl("c"))) {
      cleanup();
      return { consume: true };
    }
    return undefined;
  });

  // Safety net: restore terminal on unexpected exit
  process.on("exit", () => {
    try {
      tui.stop();
    } catch {
      // already stopped
    }
  });

  // --- message helpers ------------------------------------------------------

  /** User messages render as a card with background color. */
  function addUserMessage(text: string) {
    const msg = new Container();
    msg.addChild(new Spacer(1));
    msg.addChild(new Markdown(text, 1, 1, markdownTheme, userMessageStyle));
    chatContainer.addChild(msg);
  }

  /**
   * Agent messages render as plain markdown, no background.
   * Any base64 data-URI images in the response are extracted and rendered
   * via the native Image component (Kitty/iTerm2) with a text fallback.
   */
  function addAgentMessage(text: string) {
    const { text: cleaned, images } = extractImages(text);
    const msg = new Container();
    msg.addChild(new Spacer(1));
    msg.addChild(new Markdown(cleaned, 1, 0, markdownTheme));

    // Render extracted images (if terminal supports them)
    const caps = getCapabilities();
    for (const img of images) {
      if (caps.images) {
        msg.addChild(new Spacer(1));
        msg.addChild(
          new Image(
            img.base64,
            img.mimeType,
            {
              fallbackColor: colors.dim,
            },
            {
              maxWidthCells: 60,
            },
          ),
        );
      } else {
        const dims = getImageDimensions(img.base64, img.mimeType) ?? undefined;
        msg.addChild(new Spacer(1));
        msg.addChild(new Markdown(imageFallback(img.mimeType, dims, img.alt), 1, 0, markdownTheme));
      }
    }

    chatContainer.addChild(msg);
  }

  // --- send -----------------------------------------------------------------

  async function send(message: string, options?: { silent?: boolean }) {
    if (isResponding) return;
    isResponding = true;
    editor.disableSubmit = true;

    // Visual: change editor border to indicate thinking
    editor.borderColor = colors.thinkingBorder;
    tui.requestRender();

    if (!options?.silent) {
      editor.addToHistory(message);
      addUserMessage(message);
    }

    // Loader in status container; give it focus so Escape cancels
    const loader = new CancellableLoader(tui, colors.spinnerFn, colors.spinnerMsgFn, "Thinking...");
    loader.onAbort = () => {
      loader.setMessage("Cancelling...");
    };
    statusContainer.addChild(loader);
    tui.setFocus(loader);
    loader.start();
    tui.requestRender();

    // Streaming state — we build the response container incrementally
    let streaming = false;
    let streamText = "";
    let reasoningText = "";
    let streamMsg: InstanceType<typeof Container> | undefined;
    let streamMd: InstanceType<typeof Markdown> | undefined;
    const toolLines: string[] = [];

    function ensureStreaming() {
      if (!streaming) {
        streaming = true;
        loader.stop();
        loader.dispose();
        statusContainer.clear();

        streamMsg = new Container();
        streamMsg.addChild(new Spacer(1));
        streamMd = new Markdown("", 1, 0, markdownTheme);
        streamMsg.addChild(streamMd);
        chatContainer.addChild(streamMsg);
      }
    }

    function updateStreamContent() {
      const parts: string[] = [];
      if (reasoningText) {
        parts.push(colors.dim("> " + reasoningText.replace(/\n/g, "\n> ")));
      }
      if (toolLines.length > 0) {
        parts.push(toolLines.join("\n"));
      }
      if (streamText) {
        parts.push(streamText);
      }
      streamMd!.setText(parts.join("\n\n"));
      tui.requestRender();
    }

    let responseText: string | undefined;
    let hasError = false;
    try {
      const stream = instance.chat(message, { sessionId, signal: loader.signal });
      for await (const chunk of stream) {
        if (chunk.type === "text-delta") {
          ensureStreaming();
          streamText += chunk.delta ?? "";
          updateStreamContent();
        } else if (chunk.type === "reasoning-delta") {
          ensureStreaming();
          reasoningText += chunk.delta ?? "";
          updateStreamContent();
        } else if (chunk.type === "tool-input-available") {
          ensureStreaming();
          const toolName = chunk.toolName ?? "tool";
          const input = chunk.input as Record<string, unknown> | undefined;
          const toolLabel = `\`${toolName}\` ${input ? formatToolArgs(input) : ""}`;
          toolLines.push(toolLabel);
          updateStreamContent();
        } else if (chunk.type === "error") {
          hasError = true;
          responseText = colors.error(chunk.errorText ?? "Unknown error");
        }
      }
    } catch (err) {
      if (loader.aborted) {
        responseText = colors.dim("(cancelled)");
      } else {
        responseText = colors.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      hasError = true;
    }

    // Clean up loader (may already be stopped if streaming started)
    if (!streaming) {
      loader.stop();
      loader.dispose();
      statusContainer.clear();
    }

    if (responseText != null) {
      // Error or batch fallback — remove any partial stream widget and show final
      if (streaming && streamMsg) {
        chatContainer.removeChild(streamMsg);
      }
      addAgentMessage(responseText);
    } else if (!streaming && !hasError) {
      // No streaming events and no error — show empty response
      addAgentMessage(streamText || colors.dim("(no response)"));
    }

    // Restore editor
    editor.borderColor = editorTheme.borderColor;
    isResponding = false;
    editor.disableSubmit = false;
    editor.setText("");
    tui.setFocus(editor);
    tui.requestRender();
  }

  // --- submit handler -------------------------------------------------------

  editor.onSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isResponding) return;

    // Slash commands
    if (trimmed === "/clear") {
      chatContainer.clear();
      editor.setText("");
      tui.requestRender();
      return;
    }
    if (trimmed === "/exit") {
      editor.setText("");
      cleanup();
      return;
    }

    send(trimmed);
  };

  // --- start ----------------------------------------------------------------
  tui.start();

  // Bootstrap message (e.g. post-deploy onboarding) — silent, no user card
  if (opts?.initialMessage) {
    await send(opts.initialMessage, { silent: true });
  }

  await exitPromise;

  // Drain lingering Kitty key events for clean terminal restoration
  await terminal.drainInput();
  process.exit(0);
}
