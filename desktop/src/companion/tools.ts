/**
 * Agent tool definitions and executors.
 * Each tool can be called by the LLM via Ollama's tool calling API.
 */

const OLLAMA_BASE = "http://localhost:11434";
const COMFYUI_BASE = "http://localhost:8188";
const N8N_PROXY_BASE = "http://localhost:5679";
export const backgroundJobs = new Map<string, { service: string, action: string, startTime: number }>();
export const appSystemLogs: { timestamp: string; message: string; type: "info" | "error" | "success" }[] = [];

export function addSystemLog(message: string, type: "info" | "error" | "success" = "info") {
  appSystemLogs.push({
    timestamp: new Date().toLocaleTimeString(),
    message,
    type,
  });
  if (appSystemLogs.length > 200) appSystemLogs.shift();
  
  // Custom event to notify React components
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("dream_system_logs_updated"));
  }
}

// ── Global Event Listener ────────────────────────────────
if (typeof window !== "undefined" && !(window as any)._dockerLogListener) {
  (window as any)._dockerLogListener = true;
  import("@tauri-apps/api/event").then(({ listen }) => {
    listen<{ service: string; line: string; type: string }>("docker-log", (event) => {
      // Docker pull progress writes to stderr, so it's not strictly an error
      const type = event.payload.line.toLowerCase().includes("error") ? "error" : "info";
      addSystemLog(`[${event.payload.service}] ${event.payload.line}`, type);
    }).catch(console.error);
  });
}

// ── Tool type definitions ────────────────────────────────

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

export interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

// ── Tool definitions (sent to Ollama) ────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_system_info",
      description: "Get information about the user's system: GPU, available VRAM, OS, and Docker status.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_ollama_models",
      description: "List all AI models currently installed in Ollama on the user's machine.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_running_models",
      description: "Get the currently loaded/running Ollama models and their resource usage.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "pull_model",
      description: "Download and install a new AI model from the Ollama registry. Use this when the user wants a new model.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string", description: "The model name to pull, e.g. 'qwen3:8b' or 'llama3.2:3b'" },
        },
        required: ["model"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_docker_services",
      description: "Check the status of Docker containers running DreamServer services.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "open_tool",
      description: "Open an embedded tool in the DreamServer app. Available tools: 'images' (ComfyUI for AI image generation), 'workflows' (n8n for automation), 'research' (Open WebUI for web research).",
      parameters: {
        type: "object",
        properties: {
          tool_id: {
            type: "string",
            description: "The tool to open",
            enum: ["images", "workflows", "research"],
          },
        },
        required: ["tool_id"],
      },
    },
  },
  // ── ComfyUI tools ────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "list_comfyui_models",
      description: "List all AI image generation models available in ComfyUI. Returns checkpoints, LoRAs, VAEs, text encoders, and diffusion models.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Queue a ComfyUI workflow for image/video generation. Pass a valid ComfyUI API-format workflow JSON. Returns the prompt_id to track progress.",
      parameters: {
        type: "object",
        properties: {
          workflow: { type: "string", description: "The ComfyUI workflow as a JSON string in API format (node id → node config dict)" },
        },
        required: ["workflow"],
      },
    },
  },
  // ── n8n tools ────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "list_n8n_workflows",
      description: "List all n8n automation workflows, showing their names, IDs, and whether they are active.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_n8n_workflow",
      description: "Create a new n8n workflow from a JSON definition. Use this to generate automation templates for the user. The workflow is created in inactive state so the user can review and adjust it in the n8n UI before activating.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Human-readable name for the workflow" },
          nodes: { type: "string", description: "The workflow nodes array as a JSON string" },
          connections: { type: "string", description: "The workflow connections object as a JSON string" },
        },
        required: ["name", "nodes", "connections"],
      },
    },
  },
  // ── Catalog tools ──────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "list_service_catalog",
      description: "List all available DreamServer services from the extension catalog. Shows service names, descriptions, categories, dependencies, GPU requirements, and features. Use this when the user asks what services are available, what they can install, or wants to explore the DreamServer ecosystem.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_service_health",
      description: "Check if a specific DreamServer service is running by pinging its health endpoint. Use this after starting a service to confirm it's healthy, or when the user asks if a specific service is running.",
      parameters: {
        type: "object",
        properties: {
          service_id: { type: "string", description: "The service ID from the catalog, e.g. 'comfyui', 'n8n', 'tts'" },
        },
        required: ["service_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_n8n_workflow",
      description: "Trigger an existing n8n workflow by its ID. The workflow must exist (use list_n8n_workflows to find IDs).",
      parameters: {
        type: "object",
        properties: {
          workflow_id: { type: "string", description: "The n8n workflow ID to execute" },
        },
        required: ["workflow_id"],
      },
    },
  },
];

// ── Tool executors ───────────────────────────────────────

type ToolExecutorContext = {
  onOpenTool?: (toolId: string) => void;
};

async function getSystemInfo(): Promise<string> {
  const info: Record<string, unknown> = {
    os: navigator.platform,
    userAgent: navigator.userAgent,
  };

  // Check GPU via Ollama's running model info
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/ps`);
    if (res.ok) {
      const data = await res.json();
      const models = data.models ?? [];
      if (models.length > 0) {
        const m = models[0];
        info.gpu_info = {
          processor: m.size_vram ? `${Math.round(m.size_vram / 1e9)}GB VRAM in use` : "unknown",
          details: m.details,
        };
      }
    }
  } catch { /* offline */ }

  // Check Docker
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2000);
    const res = await fetch("http://localhost:2375/version", { signal: controller.signal });
    if (res.ok) {
      const data = await res.json();
      info.docker = { version: data.Version, running: true };
    }
  } catch {
    info.docker = { running: false, note: "Docker API not exposed on localhost:2375 or not running" };
  }

  return JSON.stringify(info, null, 2);
}

async function listOllamaModels(): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return JSON.stringify({ error: "Ollama not reachable" });
    const data = await res.json();
    const allModels = data.models ?? [];

    const local = allModels
      .filter((m: { name: string }) => !m.name.includes(":cloud"))
      .map((m: {
        name: string;
        size: number;
        details: { parameter_size: string; family: string; quantization_level: string };
      }) => ({
        name: m.name,
        size_gb: (m.size / 1e9).toFixed(1),
        parameters: m.details?.parameter_size,
        family: m.details?.family,
        quantization: m.details?.quantization_level,
      }));

    const cloud = allModels
      .filter((m: { name: string }) => m.name.includes(":cloud"))
      .map((m: { name: string }) => m.name);

    return JSON.stringify({
      local_models: local,
      cloud_models: cloud.length > 0 ? cloud : undefined,
      cloud_note: cloud.length > 0 ? "These are Ollama Cloud-hosted models, not stored locally" : undefined,
      total_local: local.length,
    }, null, 2);
  } catch {
    return JSON.stringify({ error: "Cannot connect to Ollama" });
  }
}

async function getRunningModels(): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/ps`);
    if (!res.ok) return JSON.stringify({ error: "Ollama not reachable" });
    const data = await res.json();
    const models = (data.models ?? []).map((m: {
      name: string;
      size: number;
      size_vram: number;
      details: { parameter_size: string };
      expires_at: string;
    }) => ({
      name: m.name,
      size_gb: (m.size / 1e9).toFixed(1),
      vram_gb: ((m.size_vram ?? 0) / 1e9).toFixed(1),
      parameters: m.details?.parameter_size,
      expires_at: m.expires_at,
    }));
    return JSON.stringify({
      note: "These are models currently loaded in Ollama's memory. You (the assistant) are NOT any of these models — you are a companion AI running via the model selected in the chat header.",
      loaded_models: models,
    }, null, 2);
  } catch {
    return JSON.stringify({ error: "Cannot connect to Ollama" });
  }
}

async function pullModel(model: string): Promise<string> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
    });
    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({ error: `Pull failed: ${text}` });
    }
    return JSON.stringify({ success: true, message: `Model '${model}' pulled successfully` });
  } catch (e) {
    return JSON.stringify({ error: `Pull failed: ${(e as Error).message}` });
  }
}

export async function checkDockerServices(): Promise<string> {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);

    // Try Docker socket API
    const res = await fetch("http://localhost:2375/containers/json?all=true", {
      signal: controller.signal,
    });
    if (res.ok) {
      const containers = await res.json();
      const services = containers
        .filter((c: { Names: string[] }) => c.Names?.some((n: string) => n.includes("dream")))
        .map((c: { Names: string[]; State: string; Status: string; Image: string }) => ({
          name: c.Names[0]?.replace("/", ""),
          state: c.State,
          status: c.Status,
          image: c.Image,
        }));
      return JSON.stringify({ services, total: services.length }, null, 2);
    }
    return JSON.stringify({ error: "Docker API returned error" });
  } catch {
    // Docker API not directly available — try a health check approach
    const checks = [
      { name: "ComfyUI (Images)", url: "http://localhost:8188" },
      { name: "n8n (Workflows)", url: "http://localhost:5679" },
      { name: "Open WebUI (Research)", url: "http://localhost:3000" },
      { name: "Ollama", url: `${OLLAMA_BASE}/api/tags` },
    ];

    const results = await Promise.all(
      checks.map(async (svc) => {
        try {
          const ctrl = new AbortController();
          setTimeout(() => ctrl.abort(), 2000);
          const r = await fetch(svc.url, { signal: ctrl.signal });
          return { name: svc.name, status: r.ok ? "running" : "error", code: r.status };
        } catch {
          return { name: svc.name, status: "offline" };
        }
      })
    );
    return JSON.stringify({ services: results }, null, 2);
  }
}

function openTool(toolId: string, ctx: ToolExecutorContext): string {
  if (ctx.onOpenTool) {
    ctx.onOpenTool(toolId);
    const names: Record<string, string> = {
      images: "ComfyUI (Image Generation)",
      workflows: "n8n (Workflow Automation)",
      research: "Open WebUI (Research)",
    };
    return JSON.stringify({ success: true, opened: names[toolId] ?? toolId });
  }
  return JSON.stringify({ error: "Tool switching not available" });
}

// ── ComfyUI executors ──────────────────────────────────────

const COMFYUI_MODEL_FOLDERS = ["checkpoints", "loras", "vae", "text_encoders", "diffusion_models"];

async function listComfyuiModels(): Promise<string> {
  try {
    const results: Record<string, string[]> = {};
    let totalCount = 0;

    await Promise.all(
      COMFYUI_MODEL_FOLDERS.map(async (folder) => {
        try {
          const res = await fetch(`${COMFYUI_BASE}/api/models/${folder}`);
          if (res.ok) {
            const models = await res.json();
            results[folder] = models;
            totalCount += models.length;
          } else {
            results[folder] = [];
          }
        } catch {
          results[folder] = [];
        }
      })
    );

    return JSON.stringify({
      models: results,
      total: totalCount,
      note: totalCount === 0
        ? "No models found. The user needs to download models into the ComfyUI models directory."
        : undefined,
    }, null, 2);
  } catch (e) {
    return JSON.stringify({ error: `ComfyUI not reachable: ${(e as Error).message}` });
  }
}

async function generateImage(workflowJson: string): Promise<string> {
  try {
    let workflow: Record<string, unknown>;
    try {
      workflow = JSON.parse(workflowJson);
    } catch {
      return JSON.stringify({ error: "Invalid workflow JSON" });
    }

    const res = await fetch(`${COMFYUI_BASE}/api/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({ error: `ComfyUI rejected the workflow: ${text}` });
    }

    const data = await res.json();
    return JSON.stringify({
      success: true,
      prompt_id: data.prompt_id,
      message: "Workflow queued for execution. The user can see progress in the ComfyUI panel.",
    });
  } catch (e) {
    return JSON.stringify({ error: `ComfyUI not reachable: ${(e as Error).message}` });
  }
}

// ── n8n executors ──────────────────────────────────────────

async function listN8nWorkflows(): Promise<string> {
  try {
    const res = await fetch(`${N8N_PROXY_BASE}/rest/workflows`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return JSON.stringify({ error: `n8n API error: ${res.status}` });

    const data = await res.json();
    const workflows = (data.data ?? []).map((w: { id: string; name: string; active: boolean; updatedAt: string }) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      updatedAt: w.updatedAt,
    }));

    return JSON.stringify({
      workflows,
      total: data.count ?? workflows.length,
      note: workflows.length === 0
        ? "No workflows found. You can create a new one with create_n8n_workflow or the user can build one in the n8n UI."
        : undefined,
    }, null, 2);
  } catch (e) {
    return JSON.stringify({ error: `n8n not reachable: ${(e as Error).message}` });
  }
}

async function createN8nWorkflow(name: string, nodesJson: string, connectionsJson: string): Promise<string> {
  try {
    let nodes: unknown[];
    let connections: Record<string, unknown>;
    try {
      nodes = JSON.parse(nodesJson);
      connections = JSON.parse(connectionsJson);
    } catch {
      return JSON.stringify({ error: "Invalid nodes or connections JSON" });
    }

    const res = await fetch(`${N8N_PROXY_BASE}/rest/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        nodes,
        connections,
        active: false, // Always inactive so user can review first
        settings: {},
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({ error: `Failed to create workflow: ${text}` });
    }

    const data = await res.json();
    return JSON.stringify({
      success: true,
      workflow_id: data.id,
      name: data.name,
      message: "Workflow created in inactive state. Tell the user to open the Workflows tool to review and activate it.",
    });
  } catch (e) {
    return JSON.stringify({ error: `n8n not reachable: ${(e as Error).message}` });
  }
}

async function executeN8nWorkflow(workflowId: string): Promise<string> {
  try {
    // n8n's test webhook endpoint for manual execution
    const res = await fetch(`${N8N_PROXY_BASE}/rest/workflows/${workflowId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowData: {} }),
    });

    if (!res.ok) {
      const text = await res.text();
      return JSON.stringify({ error: `Failed to execute workflow: ${text}` });
    }

    const data = await res.json();
    return JSON.stringify({
      success: true,
      execution_id: data.data?.id,
      message: `Workflow executed. Execution ID: ${data.data?.id ?? "unknown"}.`,
    });
  } catch (e) {
    return JSON.stringify({ error: `n8n not reachable: ${(e as Error).message}` });
  }
}

// ── Catalog executors ──────────────────────────────────────────

/** Known health endpoints for services. Updated from manifest data when catalog is loaded. */
const SERVICE_HEALTH_MAP: Record<string, { port: number; health: string }> = {
  "comfyui": { port: 8188, health: "/" },
  "n8n": { port: 5678, health: "/healthz" },
  "tts": { port: 8880, health: "/health" },
  "whisper": { port: 9000, health: "/health" },
  "searxng": { port: 8888, health: "/healthz" },
  "qdrant": { port: 6333, health: "/healthz" },
  "embeddings": { port: 8090, health: "/health" },
  "perplexica": { port: 3004, health: "/" },
  "openclaw": { port: 7860, health: "/" },
  "litellm": { port: 4000, health: "/health" },
  "langfuse": { port: 3006, health: "/api/public/health" },
  "privacy-shield": { port: 8085, health: "/health" },
  "open-webui": { port: 3000, health: "/" },
  "ape": { port: 7890, health: "/health" },
  "token-spy": { port: 3002, health: "/" },
};

async function listServiceCatalog(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{
      services: {
        id: string;
        name: string;
        category: string;
        description: string | null;
        depends_on: string[];
        gpu_backends: string[];
        port: number;
        external_port: number;
        health_endpoint: string;
        has_compose: boolean;
        features: {
          id: string;
          name: string;
          description: string;
          category: string;
          vram_gb: number | null;
          setup_time: string | null;
        }[];
      }[];
      dream_server_found: boolean;
      error: string | null;
    }>("list_service_catalog");

    if (result.error) {
      return JSON.stringify({ error: result.error });
    }

    // Update the health map with real data from manifests
    for (const svc of result.services) {
      SERVICE_HEALTH_MAP[svc.id] = {
        port: svc.external_port || svc.port,
        health: svc.health_endpoint,
      };
    }

    // Format for the LLM — group by category
    const catalog = result.services.map((svc) => ({
      id: svc.id,
      name: svc.name,
      category: svc.category,
      description: svc.description,
      depends_on: svc.depends_on.length > 0 ? svc.depends_on : undefined,
      gpu: svc.gpu_backends.length > 0 ? svc.gpu_backends : undefined,
      installable: svc.has_compose,
      features: svc.features.length > 0
        ? svc.features.map((f) => ({
            name: f.name,
            description: f.description,
            vram_gb: f.vram_gb || undefined,
            setup_time: f.setup_time || undefined,
          }))
        : undefined,
    }));

    return JSON.stringify({
      services: catalog,
      total: catalog.length,
      installable: catalog.filter((s) => s.installable).length,
      tip: "To start a service, use manage_docker_service with action 'up'. To check if it's running, use check_service_health.",
    }, null, 2);
  } catch (e) {
    // Fallback: return a static list if Tauri IPC is not available (dev mode)
    return JSON.stringify({
      error: `Could not read service catalog: ${(e as Error).message}`,
      tip: "The catalog is read from the DreamServer install directory. Make sure DreamServer is installed.",
    });
  }
}

async function checkServiceHealth(serviceId: string): Promise<string> {
  const entry = SERVICE_HEALTH_MAP[serviceId];
  if (!entry) {
    return JSON.stringify({
      service: serviceId,
      status: "unknown",
      error: `Unknown service '${serviceId}'. Use list_service_catalog to see available services.`,
    });
  }

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    const url = `http://localhost:${entry.port}${entry.health}`;
    const res = await fetch(url, { signal: controller.signal });

    return JSON.stringify({
      service: serviceId,
      status: res.ok ? "running" : "unhealthy",
      http_status: res.status,
      url,
    });
  } catch {
    return JSON.stringify({
      service: serviceId,
      status: "offline",
      message: `Service '${serviceId}' is not reachable on port ${entry.port}. It may need to be started with manage_docker_service.`,
    });
  }
}

async function manageDockerService(action: string, service: string): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    
    // For actions that take a long time, fire-and-forget in the background
    if (action === "up" || action === "pull" || action === "restart") {
      backgroundJobs.set(service, { service, action, startTime: Date.now() });
      addSystemLog(`[Job Started] ${action} -> ${service}`, "info");
      
      invoke<{ success: boolean; output: string; error?: string }>("docker_compose_action", { action, service })
        .then((res) => {
          backgroundJobs.delete(service);
          if (res.success) {
            addSystemLog(`[Job Success] ${action} -> ${service}\n${res.output || "No output"}`, "success");
          } else {
            addSystemLog(`[Job Failed] ${action} -> ${service}\nError: ${res.error}\nOutput: ${res.output}`, "error");
          }
        })
        .catch((e) => {
          backgroundJobs.delete(service);
          addSystemLog(`[Job Crashed] ${action} -> ${service}\n${e}`, "error");
        });
        
      return JSON.stringify({ 
        success: true, 
        message: `The '${action}' operation for '${service}' has started in the background. Tell the user they can track its progress in the sidebar.`
      });
    }
    
    const result = await invoke<{ success: boolean; output: string; error?: string }>("docker_compose_action", { action, service });

    // Parse newline-delimited JSON output from docker compose ps so the LLM gets a clean array
    if (action === "ps" && result.success && typeof result.output === "string") {
      try {
        const lines = result.output.trim().split("\n").filter(Boolean);
        const parsed = lines.map((l: any) => JSON.parse(l));
        return JSON.stringify({ success: true, containers: parsed }, null, 2);
      } catch (e) {
        // Fall through to raw output if parse fails
      }
    }

    return JSON.stringify(result, null, 2);
  } catch (err) {
    // Fallback: try Docker API directly for status checks
    if (action === "ps") {
      try {
        const res = await fetch("http://localhost:2375/containers/json?all=true");
        if (res.ok) {
          const containers = await res.json();
          const dreamContainers = containers
            .filter((c: { Names: string[] }) => 
              c.Names?.some((n: string) => n.includes("dream"))
            )
            .map((c: { Names: string[]; State: string; Status: string; Image: string }) => ({
              name: c.Names[0]?.replace("/", ""),
              state: c.State,
              status: c.Status,
              image: c.Image,
            }));
          return JSON.stringify({ containers: dreamContainers }, null, 2);
        }
      } catch { /* fall through */ }
    }
    return JSON.stringify({ 
      error: `Docker management requires the DreamServer desktop app. ${(err as Error).message}` 
    });
  }
}

// ── Main executor ────────────────────────────────────────

export async function executeTool(
  call: ToolCall,
  ctx: ToolExecutorContext,
): Promise<string> {
  const { name, arguments: args } = call.function;

  switch (name) {
    case "get_system_info":
      return getSystemInfo();
    case "list_ollama_models":
      return listOllamaModels();
    case "get_running_models":
      return getRunningModels();
    case "pull_model":
      return pullModel(args.model as string);
    case "check_docker_services":
      return checkDockerServices();
    case "open_tool":
      return openTool(args.tool_id as string, ctx);
    case "manage_docker_service":
      return manageDockerService(args.action as string, args.service as string);
    // ComfyUI
    case "list_comfyui_models":
      return listComfyuiModels();
    case "generate_image":
      return generateImage(args.workflow as string);
    // n8n
    case "list_n8n_workflows":
      return listN8nWorkflows();
    case "create_n8n_workflow":
      return createN8nWorkflow(args.name as string, args.nodes as string, args.connections as string);
    // Catalog
    case "list_service_catalog":
      return listServiceCatalog();
    case "check_service_health":
      return checkServiceHealth(args.service_id as string);
    case "execute_n8n_workflow":
      return executeN8nWorkflow(args.workflow_id as string);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

