import { useState, useCallback, useRef, useEffect } from "react";
import { AIModel } from "universal-llm-client";
import type { LLMChatMessage, LLMToolCall } from "universal-llm-client";
import type { Message, TextMessage, ToolMessage } from "./ChatMessageList";
import { executeTool, type ToolCall } from "./tools";
import { buildSystemPrompt } from "./personalities";
import { fetchEnvConfig } from "./config";

const MAX_TOOL_ROUNDS = 8;

export interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  isConnected: boolean;
  backendName: string | null;
  model: string | null;
  availableModels: { name: string; size: number; details: { parameter_size: string; family: string } }[];
  error: string | null;
}

export interface UseChatOptions {
  voiceId: string;
  userName: string;
  onOpenTool?: (toolId: string) => void;
}

/** Pick the best chat model from available models */
function pickDefaultModel(models: string[]): string | null {
  if (models.length === 0) return null;
  const chatModels = models.filter(
    (m) => !m.includes("embed") && !m.includes("ocr")
  );
  const qwen = chatModels.find((m) => m.startsWith("qwen3"));
  if (qwen) return qwen;
  return chatModels[0] ?? models[0];
}

// ── Tool definitions ────────────────────────────────────

const TOOL_DEFS = [
  {
    name: "get_system_info",
    description: "Get information about the user's system: GPU, available VRAM, OS, and Docker status.",
    params: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "list_ollama_models",
    description: "List all AI models currently installed in Ollama on the user's machine.",
    params: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "get_running_models",
    description: "Get the currently loaded/running Ollama models and their resource usage.",
    params: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "pull_model",
    description: "Download and install a new AI model from the Ollama registry.",
    params: {
      type: "object" as const,
      properties: { model: { type: "string", description: "Model name, e.g. 'qwen3:8b'" } },
      required: ["model"],
    },
  },
  {
    name: "check_docker_services",
    description: "Check the status of Docker containers running DreamServer services.",
    params: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "open_tool",
    description: "Open an embedded tool in the DreamServer app. Available: 'images' (ComfyUI), 'workflows' (n8n), 'research' (Open WebUI).",
    params: {
      type: "object" as const,
      properties: { tool_id: { type: "string", description: "Tool to open", enum: ["images", "workflows", "research"] } },
      required: ["tool_id"],
    },
  },
  {
    name: "manage_docker_service",
    description: "Start, stop, or restart a DreamServer Docker service. Services: 'tts' (Kokoro voice), 'comfyui' (image gen), 'n8n' (workflows), 'whisper' (speech-to-text), 'open-webui' (chat UI), 'searxng' (web search), 'embeddings', 'qdrant' (vector DB). Actions: 'up' (start), 'stop', 'restart', 'ps' (check status), 'logs' (recent logs).",
    params: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "The action to perform", enum: ["up", "stop", "restart", "ps", "logs"] },
        service: { type: "string", description: "The service name, e.g. 'tts', 'comfyui', 'n8n'" },
      },
      required: ["action", "service"],
    },
  },
  // ── ComfyUI tools ─────────────────────────────────────
  {
    name: "list_comfyui_models",
    description: "List all AI image generation models available in ComfyUI (checkpoints, LoRAs, VAEs, etc.).",
    params: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "generate_image",
    description: "Queue a ComfyUI workflow for image/video generation. Pass a valid ComfyUI API-format workflow JSON.",
    params: {
      type: "object" as const,
      properties: { workflow: { type: "string", description: "ComfyUI workflow as JSON string in API format" } },
      required: ["workflow"],
    },
  },
  // ── n8n tools ──────────────────────────────────────────
  {
    name: "list_n8n_workflows",
    description: "List all n8n automation workflows with names, IDs, and active status.",
    params: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "create_n8n_workflow",
    description: "Create a new n8n workflow template. Created inactive so the user can review it first.",
    params: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Workflow name" },
        nodes: { type: "string", description: "Workflow nodes array as JSON string" },
        connections: { type: "string", description: "Workflow connections object as JSON string" },
      },
      required: ["name", "nodes", "connections"],
    },
  },
  {
    name: "execute_n8n_workflow",
    description: "Trigger an existing n8n workflow by ID.",
    params: {
      type: "object" as const,
      properties: { workflow_id: { type: "string", description: "The n8n workflow ID" } },
      required: ["workflow_id"],
    },
  },
  // ── Catalog tools ─────────────────────────────────────
  {
    name: "list_service_catalog",
    description: "List all available DreamServer services from the extension catalog. Shows names, descriptions, categories, dependencies, GPU requirements, and features. Use this when the user asks what they can install or what services are available.",
    params: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "check_service_health",
    description: "Check if a specific DreamServer service is running by pinging its health endpoint.",
    params: {
      type: "object" as const,
      properties: { service_id: { type: "string", description: "Service ID, e.g. 'comfyui', 'n8n', 'tts'" } },
      required: ["service_id"],
    },
  },
];

// ── Hook ─────────────────────────────────────────────────

export function useChat(initialGreeting?: string, options?: UseChatOptions) {
  const [state, setState] = useState<ChatState>({
    messages: initialGreeting
      ? [{ id: crypto.randomUUID(), type: "text", role: "assistant", content: initialGreeting }]
      : [],
    isStreaming: false,
    isConnected: false,
    backendName: null,
    model: null,
    availableModels: [],
    error: null,
  });

  const aiModelRef = useRef<AIModel | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // React to greeting changes (e.g., when user changes name or voice mid-setup)
  // But only if the chat history is still just the initial message
  useEffect(() => {
    if (initialGreeting) {
      setState((prev) => {
        if (prev.messages.length <= 1 && prev.messages[0]?.type === "text" && prev.messages[0].role === "assistant") {
          return {
            ...prev,
            messages: [{ ...prev.messages[0], content: initialGreeting }]
          };
        }
        return prev;
      });
    }
  }, [initialGreeting]);

  /** Create AIModel instance — tools are registered but NOT auto-executed */
  function createModel(modelName: string, baseUrl: string): AIModel {
    const model = new AIModel({
      model: modelName,
      providers: [{ type: "ollama", url: baseUrl }],
      timeout: 120000,
      debug: true,
    });

    // Register tools so the provider sends tool definitions in the request
    const onOpenTool = optionsRef.current?.onOpenTool;
    for (const def of TOOL_DEFS) {
      model.registerTool(
        def.name,
        def.description,
        def.params,
        async (args: unknown) => {
          const a = args as Record<string, unknown>;
          const call: ToolCall = { function: { name: def.name, arguments: a } };
          return JSON.parse(await executeTool(call, { onOpenTool }));
        },
      );
    }

    return model;
  }

  /** Detect Ollama and list models */
  const connect = useCallback(async () => {
    try {
      const config = await fetchEnvConfig();
      const baseUrl = `http://localhost:${config.ollama_port}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error("Ollama not reachable");

      const data = await res.json();
      const allModels = (data.models ?? []) as { name: string; size: number; details: { parameter_size: string; family: string } }[];
      const modelNames = allModels.map((m) => m.name);
      const defaultModel = pickDefaultModel(modelNames);

      if (defaultModel) {
        aiModelRef.current = createModel(defaultModel, baseUrl);
      }

      setState((prev) => ({
        ...prev,
        isConnected: true,
        backendName: "ollama",
        model: defaultModel,
        availableModels: allModels,
        error: null,
      }));
      return true;
    } catch {
      setState((prev) => ({
        ...prev,
        isConnected: false,
        backendName: null,
        error: "No LLM backend found on this port. Check if Ollama or LiteLLM is running.",
      }));
      return false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Change the active model */
  const setModel = useCallback((modelName: string) => {
    fetchEnvConfig().then(config => {
      aiModelRef.current = createModel(modelName, `http://localhost:${config.ollama_port}`);
      setState((prev) => ({ ...prev, model: modelName }));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helper: append a message to state ──────────────────

  const appendMessage = useCallback((msg: Message) => {
    setState((prev) => ({ ...prev, messages: [...prev.messages, msg] }));
  }, []);

  const updateMessage = useCallback((id: string, updates: Record<string, unknown>) => {
    setState((prev) => ({
      ...prev,
      messages: prev.messages.map((m) =>
        m.id === id ? { ...m, ...updates } as Message : m
      ),
    }));
  }, []);

  // ── Execute a single tool call with visible UI ─────────

  async function executeToolVisible(toolCall: LLMToolCall): Promise<LLMChatMessage> {
    const fnName = toolCall.function.name;
    let fnArgs: Record<string, unknown> = {};
    try {
      fnArgs = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments as Record<string, unknown>;
    } catch {
      fnArgs = {};
    }

    // Create a visible tool bubble
    const bubbleId = crypto.randomUUID();
    const toolMsg: ToolMessage = {
      id: bubbleId,
      type: "tool",
      toolName: fnName,
      toolArgs: fnArgs,
      status: "running",
    };
    appendMessage(toolMsg);

    try {
      const call: ToolCall = { function: { name: fnName, arguments: fnArgs } };
      const result = await executeTool(call, { onOpenTool: optionsRef.current?.onOpenTool });
      console.log(`[chat] Tool ${fnName} result:`, result);

      // Update bubble to done
      updateMessage(bubbleId, {
        status: "done" as const,
        result,
      });

      return {
        role: "tool" as const,
        content: result,
        tool_call_id: toolCall.id,
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      console.error(`[chat] Tool ${fnName} error:`, err);

      updateMessage(bubbleId, {
        status: "error" as const,
        error: errorMsg,
      });

      return {
        role: "tool" as const,
        content: JSON.stringify({ error: errorMsg }),
        tool_call_id: toolCall.id,
      };
    }
  }

  // ── Main send with streaming + tool loop ───────────────

  const send = useCallback(async (content: string) => {
    const ai = aiModelRef.current;
    if (!ai) {
      setState((prev) => ({ ...prev, error: "Not connected to any LLM backend." }));
      return;
    }

    const userMsg: TextMessage = { id: crypto.randomUUID(), type: "text", role: "user", content };
    let activeAssistantId = crypto.randomUUID();

    setState((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        userMsg,
        { id: activeAssistantId, type: "text", role: "assistant", content: "" } as TextMessage,
      ],
      isStreaming: true,
      error: null,
    }));

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const systemPrompt = buildSystemPrompt(
        optionsRef.current?.voiceId ?? "af_heart",
        optionsRef.current?.userName ?? "Friend",
      );

      // Build conversation context — include text and tool messages
      const conversationMessages: LLMChatMessage[] = [
        { role: "system", content: systemPrompt },
      ];
      for (const m of state.messages) {
        if (m.type === "text" && m.content) {
          conversationMessages.push({ role: m.role, content: m.content });
        } else if (m.type === "tool" && m.status === "done" && m.result) {
          // Include completed tool results so the LLM remembers what tools returned
          conversationMessages.push({
            role: "tool" as const,
            content: typeof m.result === "string" ? m.result : JSON.stringify(m.result),
            tool_call_id: m.id,
          });
        }
      }
      conversationMessages.push({ role: "user", content });

      // ── Streaming + Tool Loop ──────────────────────────
      let round = 0;

      while (round < MAX_TOOL_ROUNDS) {
        round++;
        let streamedContent = "";
        let pendingToolCalls: LLMToolCall[] = [];

        console.log(`[chat] Round ${round} — streaming (${conversationMessages.length} msgs)`);

        const stream = ai.chatStream(conversationMessages, {
          decoder: "interleaved-reasoning",
        });

        for await (const event of stream) {
          if (abortController.signal.aborted) break;

          switch (event.type) {
            case "text":
              streamedContent += event.content;
              updateMessage(activeAssistantId, { content: streamedContent });
              break;
            case "thinking":
              console.log("[chat] 💭", event.content.slice(0, 120));
              break;
            case "progress":
              console.log("[chat] ⏳", event.content);
              break;
            case "tool_call":
              console.log("[chat] 🔧 Tool calls:", event.calls.map(c => c.function.name));
              pendingToolCalls = event.calls;
              break;
          }
        }

        if (abortController.signal.aborted) break;

        // If no tool calls — streaming is done, break
        if (pendingToolCalls.length === 0) {
          // Clean up empty assistant bubbles
          if (!streamedContent.trim()) {
            setState((prev) => ({
              ...prev,
              messages: prev.messages.filter((m) => m.id !== activeAssistantId),
            }));
          }
          break;
        }

        // Tool calls detected — execute with visible bubbles
        // Add assistant's tool_calls message to conversation history
        conversationMessages.push({
          role: "assistant",
          content: streamedContent || "",
          tool_calls: pendingToolCalls,
        });

        // Execute each tool call
        for (const tc of pendingToolCalls) {
          const toolResult = await executeToolVisible(tc);
          conversationMessages.push(toolResult);
        }

        // Create new assistant message for the next round's streamed response
        const nextId = crypto.randomUUID();
        activeAssistantId = nextId;
        appendMessage({ id: nextId, type: "text", role: "assistant", content: "" });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("[chat] Error:", err);
      setState((prev) => ({
        ...prev,
        error: `Chat error: ${(err as Error).message}`,
      }));
    } finally {
      abortRef.current = null;
      setState((prev) => ({ ...prev, isStreaming: false }));
    }
  }, [state.messages, appendMessage, updateMessage]);

  /** Stop the current stream */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Clear chat and start fresh */
  const clear = useCallback((greeting?: string) => {
    abortRef.current?.abort();
    setState((prev) => ({
      ...prev,
      messages: greeting
        ? [{ id: crypto.randomUUID(), type: "text" as const, role: "assistant" as const, content: greeting }]
        : [],
      isStreaming: false,
      error: null,
    }));
  }, []);

  // Recreate model when onOpenTool changes
  useEffect(() => {
    if (aiModelRef.current && state.model) {
      fetchEnvConfig().then(config => {
        aiModelRef.current = createModel(state.model!, `http://localhost:${config.ollama_port}`);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.onOpenTool]);

  return { ...state, connect, send, stop, clear, setModel };
}
