import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import OpenAI from "openai";
import type { PromptTemplate } from "../config/prompts.js";
import { getOpenAIConfig } from "../config/llm.js";
import { loadMcpToolBindings, type McpApprovalMode, type McpToolBinding } from "../mcp/loadTools.js";
import type { ChatStreamEvent, ChatUsagePayload } from "./chatEvents.js";
import { getModelById, getModelOptionById, isDeepSeekReasoningModel, type ProviderOverrides } from "./createModel.js";
import {
  beginPendingRunResume,
  deletePendingRun,
  savePendingRun,
  type DeepSeekPendingRunRecord,
  type DeepSeekToolMessage,
  type PendingRunRecord,
  type StandardPendingRunRecord,
} from "./pendingRuns.js";

type InvokeResponse = Promise<AIMessage>;
type StreamResponse = Promise<AsyncIterable<AIMessageChunk>>;

export interface AgentChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentChatRequest {
  sessionId: string;
  messages: AgentChatMessage[];
  modelId: string;
  systemPrompt?: string;
  promptId?: string;
  promptTemplates?: PromptTemplate[];
  tools?: McpToolBinding[];
  providerOverrides?: ProviderOverrides;
}

type DeepSeekPendingToolCall = {
  id?: string;
  name?: string;
  arguments: string;
};

type NormalizedDeepSeekToolCall = {
  id: string;
  name: string;
  args: unknown;
  rawArguments: string;
};

type StandardRunOptions = {
  runId: string;
  sessionId: string;
  messageId: string;
  modelId: string;
  systemPrompt?: string;
  providerOverrides?: ProviderOverrides;
  toolBindings: McpToolBinding[];
  workingMessages: BaseMessage[];
  pendingTool?: StandardPendingRunRecord["pendingTool"];
};

type DeepSeekRunOptions = {
  runId: string;
  sessionId: string;
  messageId: string;
  modelId: string;
  systemPrompt?: string;
  providerOverrides?: ProviderOverrides;
  toolBindings: McpToolBinding[];
  workingMessages: DeepSeekToolMessage[];
  pendingTool?: DeepSeekPendingRunRecord["pendingTool"];
};

function nowIso(): string {
  return new Date().toISOString();
}

function safeInvoke(model: unknown, messages: BaseMessage[]): InvokeResponse {
  const fn = (model as { invoke?: (input: BaseMessage[]) => InvokeResponse }).invoke;
  if (typeof fn !== "function") {
    throw new Error("Model invoke not available");
  }
  return fn.call(model, messages);
}

function safeStream(model: unknown, messages: BaseMessage[]): StreamResponse {
  const fn = (model as { stream?: (input: BaseMessage[]) => StreamResponse }).stream;
  if (typeof fn !== "function") {
    throw new Error("Model stream not available");
  }
  return fn.call(model, messages);
}

function toLangChainMessages(messages: AgentChatMessage[], systemPrompt?: string): BaseMessage[] {
  const result: BaseMessage[] = [];

  if (systemPrompt) {
    result.push(new SystemMessage(systemPrompt));
  }

  for (const message of messages) {
    if (message.role === "system") {
      result.push(new SystemMessage(message.content));
    } else if (message.role === "user") {
      result.push(new HumanMessage(message.content));
    } else {
      result.push(new AIMessage(message.content));
    }
  }

  return result;
}

function toDeepSeekMessages(messages: AgentChatMessage[], systemPrompt?: string): DeepSeekToolMessage[] {
  const result: DeepSeekToolMessage[] = [];

  if (systemPrompt) {
    result.push({
      role: "system",
      content: systemPrompt,
    });
  }

  for (const message of messages) {
    result.push({
      role: message.role,
      content: message.content,
    });
  }

  return result;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("");
  }

  return "";
}

function extractStructuredText(value: unknown): string {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.map((item) => extractStructuredText(item)).join("");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.text === "string") {
      return record.text;
    }

    if ("content" in record) {
      return extractStructuredText(record.content);
    }
  }

  return "";
}

function extractReasoningDelta(chunk: AIMessageChunk): string {
  const rawResponse = chunk.additional_kwargs?.__raw_response;
  if (!rawResponse || typeof rawResponse !== "object") return "";

  const choices = (rawResponse as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return "";

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return "";

  const delta = (firstChoice as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") return "";

  const reasoningValue = (delta as Record<string, unknown>).reasoning_content ?? (delta as Record<string, unknown>).reasoning;
  return extractStructuredText(reasoningValue);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeUsage(value: unknown): ChatUsagePayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  return {
    inputTokens:
      typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : typeof usage.prompt_tokens === "number"
          ? usage.prompt_tokens
          : undefined,
    outputTokens:
      typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : typeof usage.completion_tokens === "number"
          ? usage.completion_tokens
          : undefined,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : undefined,
    raw: value,
  };
}

function toFinalAiMessage(chunk: AIMessageChunk): AIMessage {
  return new AIMessage({
    content: chunk.content,
    tool_calls: chunk.tool_calls,
    invalid_tool_calls: chunk.invalid_tool_calls,
    usage_metadata: chunk.usage_metadata,
    additional_kwargs: chunk.additional_kwargs,
    response_metadata: chunk.response_metadata,
    id: chunk.id,
    name: chunk.name,
  });
}

function createToolMessageFromError(toolCallId: string, message: string): ToolMessage {
  return new ToolMessage({
    content: message,
    tool_call_id: toolCallId,
    status: "error",
    artifact: { error: message },
  });
}

function createToolMessageFromDenied(toolCallId: string, message: string): ToolMessage {
  return new ToolMessage({
    content: message,
    tool_call_id: toolCallId,
    status: "error",
    artifact: { denied: true, message },
  });
}

async function executeToolCall(tool: McpToolBinding["tool"], toolCall: NonNullable<AIMessage["tool_calls"]>[number]) {
  const result = await tool.invoke({
    ...toolCall,
    id: toolCall.id,
    type: "tool_call",
  });

  if (result instanceof ToolMessage) {
    return {
      toolMessage: result,
      display: extractTextContent(result.content),
      output: result.artifact ?? result.content,
      status: result.status === "error" ? ("error" as const) : ("success" as const),
    };
  }

  const display = stringifyUnknown(result);
  return {
    toolMessage: new ToolMessage({
      content: display,
      tool_call_id: toolCall.id ?? crypto.randomUUID(),
      status: "success",
      artifact: result,
    }),
    display,
    output: result,
    status: "success" as const,
  };
}

function toOpenAITools(toolBindings: McpToolBinding[] | undefined) {
  if (!toolBindings?.length) return undefined;

  return toolBindings.map((binding) => ({
    type: "function" as const,
    function: {
      name: binding.tool.name,
      description: binding.tool.description,
      parameters: toJsonSchema(binding.tool.schema),
    },
  }));
}

function normalizeDeepSeekToolCalls(toolCalls: DeepSeekPendingToolCall[]): NormalizedDeepSeekToolCall[] {
  return toolCalls
    .map((toolCall, index) => {
      if (!toolCall.name) return null;

      let parsedArgs: unknown = {};
      try {
        parsedArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
      } catch {
        parsedArgs = {};
      }

      return {
        id: toolCall.id ?? `call_${index}_${crypto.randomUUID()}`,
        name: toolCall.name,
        args: parsedArgs,
        rawArguments: toolCall.arguments,
      };
    })
    .filter((toolCall): toolCall is NormalizedDeepSeekToolCall => toolCall !== null);
}

function createDeepSeekClient(overrides?: ProviderOverrides) {
  const option = getModelOptionById("deepseek-reasoner");
  const { apiKey, baseURL } = getOpenAIConfig(overrides);

  return {
    client: new OpenAI({
      apiKey,
      baseURL,
    }),
    model: option.model,
  };
}

function createBindingMap(toolBindings: McpToolBinding[]): Map<string, McpToolBinding> {
  return new Map(toolBindings.map((binding) => [binding.bindingName, binding] as const));
}

function getToolInfo(bindingsMap: Map<string, McpToolBinding>, bindingName: string): {
  bindingName: string;
  toolName: string;
  serverName: string;
  approvalMode: McpApprovalMode;
  binding?: McpToolBinding;
} {
  const binding = bindingsMap.get(bindingName);
  if (!binding) {
    return {
      bindingName,
      toolName: bindingName,
      serverName: "unknown",
      approvalMode: "solo",
    };
  }
  return {
    bindingName,
    toolName: binding.toolName,
    serverName: binding.serverName,
    approvalMode: binding.approvalMode,
    binding,
  };
}

function approvalRequiredEvent(params: {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  serverName: string;
  input: unknown;
  approvalMode: McpApprovalMode;
}): ChatStreamEvent {
  return {
    event: "tool_approval_required",
    data: {
      ...params,
      timestamp: nowIso(),
    },
  };
}

function approvalResolvedEvent(params: {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  serverName: string;
  decision: "approve" | "deny";
}): ChatStreamEvent {
  return {
    event: "tool_approval_resolved",
    data: {
      ...params,
      timestamp: nowIso(),
    },
  };
}

function toolStartEvent(params: {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  serverName: string;
  input: unknown;
}): ChatStreamEvent {
  return {
    event: "tool_start",
    data: {
      ...params,
      timestamp: nowIso(),
    },
  };
}

function toolResultEvent(params: {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  serverName: string;
  output: unknown;
  display: string;
  status: "success" | "error" | "denied";
}): ChatStreamEvent {
  return {
    event: "tool_result",
    data: {
      ...params,
      timestamp: nowIso(),
    },
  };
}

function messageEndEvent(messageId: string, finishReason: string, usage?: ChatUsagePayload): ChatStreamEvent {
  return {
    event: "message_end",
    data: {
      messageId,
      finishReason,
      usage,
      timestamp: nowIso(),
    },
  };
}

function errorEvent(messageId: string | undefined, message: string): ChatStreamEvent {
  return {
    event: "error",
    data: {
      messageId,
      code: "CHAT_STREAM_FAILED",
      message,
      timestamp: nowIso(),
    },
  };
}

async function* resumeStandardPendingTool(
  options: StandardRunOptions,
  bindingsMap: Map<string, McpToolBinding>
): AsyncGenerator<ChatStreamEvent> {
  const pendingTool = options.pendingTool;
  if (!pendingTool?.decision) return;

  const toolInfo = getToolInfo(bindingsMap, pendingTool.bindingName);
  yield approvalResolvedEvent({
    runId: options.runId,
    messageId: options.messageId,
    toolCallId: pendingTool.toolCallId,
    toolName: toolInfo.toolName,
    serverName: toolInfo.serverName,
    decision: pendingTool.decision,
  });

  if (pendingTool.decision === "deny") {
    const display = `Tool execution denied by user: ${toolInfo.toolName}`;
    options.workingMessages.push(createToolMessageFromDenied(pendingTool.toolCallId, display));
    yield toolResultEvent({
      runId: options.runId,
      messageId: options.messageId,
      toolCallId: pendingTool.toolCallId,
      toolName: toolInfo.toolName,
      serverName: toolInfo.serverName,
      output: { denied: true, message: display },
      display,
      status: "denied",
    });
    return;
  }

  yield toolStartEvent({
    runId: options.runId,
    messageId: options.messageId,
    toolCallId: pendingTool.toolCallId,
    toolName: toolInfo.toolName,
    serverName: toolInfo.serverName,
    input: pendingTool.input,
  });

  if (!toolInfo.binding) {
    const errorMessage = `Tool not found: ${toolInfo.toolName}`;
    options.workingMessages.push(createToolMessageFromError(pendingTool.toolCallId, errorMessage));
    yield toolResultEvent({
      runId: options.runId,
      messageId: options.messageId,
      toolCallId: pendingTool.toolCallId,
      toolName: toolInfo.toolName,
      serverName: toolInfo.serverName,
      output: { error: errorMessage },
      display: errorMessage,
      status: "error",
    });
    return;
  }

  try {
    const result = await executeToolCall(toolInfo.binding.tool, {
      id: pendingTool.toolCallId,
      name: toolInfo.binding.bindingName,
      args: pendingTool.input as Record<string, unknown>,
      type: "tool_call",
    });
    options.workingMessages.push(result.toolMessage);
    yield toolResultEvent({
      runId: options.runId,
      messageId: options.messageId,
      toolCallId: pendingTool.toolCallId,
      toolName: toolInfo.toolName,
      serverName: toolInfo.serverName,
      output: result.output,
      display: result.display,
      status: result.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    options.workingMessages.push(createToolMessageFromError(pendingTool.toolCallId, message));
    yield toolResultEvent({
      runId: options.runId,
      messageId: options.messageId,
      toolCallId: pendingTool.toolCallId,
      toolName: toolInfo.toolName,
      serverName: toolInfo.serverName,
      output: { error: message },
      display: message,
      status: "error",
    });
  }
}

async function* resumeDeepSeekPendingTool(
  options: DeepSeekRunOptions,
  bindingsMap: Map<string, McpToolBinding>
): AsyncGenerator<ChatStreamEvent> {
  const pendingTool = options.pendingTool;
  if (!pendingTool?.decision) return;

  const toolInfo = getToolInfo(bindingsMap, pendingTool.bindingName);
  yield approvalResolvedEvent({
    runId: options.runId,
    messageId: options.messageId,
    toolCallId: pendingTool.toolCallId,
    toolName: toolInfo.toolName,
    serverName: toolInfo.serverName,
    decision: pendingTool.decision,
  });

  if (pendingTool.decision === "deny") {
    const display = `Tool execution denied by user: ${toolInfo.toolName}`;
    options.workingMessages.push({
      role: "tool",
      tool_call_id: pendingTool.toolCallId,
      content: display,
    });
    yield toolResultEvent({
      runId: options.runId,
      messageId: options.messageId,
      toolCallId: pendingTool.toolCallId,
      toolName: toolInfo.toolName,
      serverName: toolInfo.serverName,
      output: { denied: true, message: display },
      display,
      status: "denied",
    });
    return;
  }

  yield toolStartEvent({
    runId: options.runId,
    messageId: options.messageId,
    toolCallId: pendingTool.toolCallId,
    toolName: toolInfo.toolName,
    serverName: toolInfo.serverName,
    input: pendingTool.input,
  });

  if (!toolInfo.binding) {
    const errorMessage = `Tool not found: ${toolInfo.toolName}`;
    options.workingMessages.push({
      role: "tool",
      tool_call_id: pendingTool.toolCallId,
      content: errorMessage,
    });
    yield toolResultEvent({
      runId: options.runId,
      messageId: options.messageId,
      toolCallId: pendingTool.toolCallId,
      toolName: toolInfo.toolName,
      serverName: toolInfo.serverName,
      output: { error: errorMessage },
      display: errorMessage,
      status: "error",
    });
    return;
  }

  try {
    const result = await executeToolCall(toolInfo.binding.tool, {
      id: pendingTool.toolCallId,
      name: toolInfo.binding.bindingName,
      args: pendingTool.input as Record<string, unknown>,
      type: "tool_call",
    });
    options.workingMessages.push({
      role: "tool",
      tool_call_id: pendingTool.toolCallId,
      content: result.display,
    });
    yield toolResultEvent({
      runId: options.runId,
      messageId: options.messageId,
      toolCallId: pendingTool.toolCallId,
      toolName: toolInfo.toolName,
      serverName: toolInfo.serverName,
      output: result.output,
      display: result.display,
      status: result.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    options.workingMessages.push({
      role: "tool",
      tool_call_id: pendingTool.toolCallId,
      content: message,
    });
    yield toolResultEvent({
      runId: options.runId,
      messageId: options.messageId,
      toolCallId: pendingTool.toolCallId,
      toolName: toolInfo.toolName,
      serverName: toolInfo.serverName,
      output: { error: message },
      display: message,
      status: "error",
    });
  }
}

async function* runStandardAgentLoop(options: StandardRunOptions): AsyncGenerator<ChatStreamEvent> {
  const model = getModelById(options.modelId, options.providerOverrides);
  const runnable =
    options.toolBindings.length > 0
      ? (model as { bindTools: (tools: McpToolBinding["tool"][]) => unknown }).bindTools(
          options.toolBindings.map((binding) => binding.tool)
        )
      : model;
  const bindingsMap = createBindingMap(options.toolBindings);

  if (options.pendingTool) {
    yield* resumeStandardPendingTool(options, bindingsMap);
  }

  while (true) {
    const stream = await safeStream(runnable, options.workingMessages);
    let finalChunk: AIMessageChunk | null = null;

    for await (const chunk of stream) {
      finalChunk = finalChunk ? finalChunk.concat(chunk) : chunk;

      const reasoningDelta = extractReasoningDelta(chunk);
      if (reasoningDelta) {
        yield {
          event: "reasoning_delta",
          data: {
            messageId: options.messageId,
            delta: reasoningDelta,
          },
        };
      }

      const delta = extractTextContent(chunk.content);
      if (delta) {
        yield {
          event: "text_delta",
          data: {
            messageId: options.messageId,
            delta,
          },
        };
      }
    }

    const response = finalChunk ? toFinalAiMessage(finalChunk) : await safeInvoke(runnable, options.workingMessages);
    options.workingMessages.push(response);

    if (!response.tool_calls?.length) {
      yield messageEndEvent(options.messageId, "stop", normalizeUsage(response.usage_metadata));
      return;
    }

    for (const toolCall of response.tool_calls) {
      const toolCallId = toolCall.id ?? crypto.randomUUID();
      const toolInfo = getToolInfo(bindingsMap, toolCall.name);

      if (toolInfo.binding?.approvalMode === "manual") {
        savePendingRun({
          kind: "standard",
          runId: options.runId,
          sessionId: options.sessionId,
          messageId: options.messageId,
          modelId: options.modelId,
          systemPrompt: options.systemPrompt,
          providerOverrides: options.providerOverrides,
          workingMessages: [...options.workingMessages],
          pendingTool: {
            toolCallId,
            bindingName: toolInfo.bindingName,
            toolName: toolInfo.toolName,
            serverName: toolInfo.serverName,
            input: toolCall.args,
            approvalMode: toolInfo.binding.approvalMode,
            requestedAt: nowIso(),
          },
        });
        yield approvalRequiredEvent({
          runId: options.runId,
          messageId: options.messageId,
          toolCallId,
          toolName: toolInfo.toolName,
          serverName: toolInfo.serverName,
          input: toolCall.args,
          approvalMode: toolInfo.binding.approvalMode,
        });
        yield messageEndEvent(options.messageId, "approval_required");
        return;
      }

      yield toolStartEvent({
        runId: options.runId,
        messageId: options.messageId,
        toolCallId,
        toolName: toolInfo.toolName,
        serverName: toolInfo.serverName,
        input: toolCall.args,
      });

      if (!toolInfo.binding) {
        const errorMessage = `Tool not found: ${toolInfo.toolName}`;
        options.workingMessages.push(createToolMessageFromError(toolCallId, errorMessage));
        yield toolResultEvent({
          runId: options.runId,
          messageId: options.messageId,
          toolCallId,
          toolName: toolInfo.toolName,
          serverName: toolInfo.serverName,
          output: { error: errorMessage },
          display: errorMessage,
          status: "error",
        });
        continue;
      }

      try {
        const result = await executeToolCall(toolInfo.binding.tool, {
          ...toolCall,
          id: toolCallId,
          name: toolInfo.binding.bindingName,
        });
        options.workingMessages.push(result.toolMessage);
        yield toolResultEvent({
          runId: options.runId,
          messageId: options.messageId,
          toolCallId,
          toolName: toolInfo.toolName,
          serverName: toolInfo.serverName,
          output: result.output,
          display: result.display,
          status: result.status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tool execution failed";
        options.workingMessages.push(createToolMessageFromError(toolCallId, message));
        yield toolResultEvent({
          runId: options.runId,
          messageId: options.messageId,
          toolCallId,
          toolName: toolInfo.toolName,
          serverName: toolInfo.serverName,
          output: { error: message },
          display: message,
          status: "error",
        });
      }
    }
  }
}

async function* runDeepSeekReasoningAgentLoop(options: DeepSeekRunOptions): AsyncGenerator<ChatStreamEvent> {
  const { client, model } = createDeepSeekClient(options.providerOverrides);
  const bindingsMap = createBindingMap(options.toolBindings);
  const openAITools = toOpenAITools(options.toolBindings);

  if (options.pendingTool) {
    yield* resumeDeepSeekPendingTool(options, bindingsMap);
  }

  while (true) {
    const stream = (await (client.chat.completions.create as (...args: unknown[]) => Promise<AsyncIterable<any>>)({
      model,
      messages: options.workingMessages,
      stream: true,
      ...(openAITools ? { tools: openAITools } : {}),
      extra_body: {
        thinking: { type: "enabled" },
      },
    })) as AsyncIterable<any>;

    let reasoningContent = "";
    let content = "";
    let finishReason = "stop";
    let usage: unknown;
    const pendingToolCalls: DeepSeekPendingToolCall[] = [];

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = chunk.usage;
      }

      const choice = chunk.choices?.[0];
      const delta = choice?.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        reasoningContent += delta.reasoning_content;
        yield {
          event: "reasoning_delta",
          data: {
            messageId: options.messageId,
            delta: delta.reasoning_content,
          },
        };
      }

      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        yield {
          event: "text_delta",
          data: {
            messageId: options.messageId,
            delta: delta.content,
          },
        };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const rawToolCall of delta.tool_calls) {
          const index = rawToolCall.index ?? 0;
          const current = pendingToolCalls[index] ?? { arguments: "" };
          pendingToolCalls[index] = {
            id: rawToolCall.id ?? current.id,
            name: rawToolCall.function?.name ?? current.name,
            arguments: `${current.arguments}${rawToolCall.function?.arguments ?? ""}`,
          };
        }
      }

      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }

    const normalizedToolCalls = normalizeDeepSeekToolCalls(pendingToolCalls);

    options.workingMessages.push({
      role: "assistant",
      content,
      reasoning_content: reasoningContent || undefined,
      ...(normalizedToolCalls.length
        ? {
            tool_calls: normalizedToolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function" as const,
              function: {
                name: toolCall.name,
                arguments: toolCall.rawArguments,
              },
            })),
          }
        : {}),
    });

    if (!normalizedToolCalls.length) {
      yield messageEndEvent(options.messageId, finishReason, normalizeUsage(usage));
      return;
    }

    for (const toolCall of normalizedToolCalls) {
      const toolInfo = getToolInfo(bindingsMap, toolCall.name);

      if (toolInfo.binding?.approvalMode === "manual") {
        savePendingRun({
          kind: "deepseek",
          runId: options.runId,
          sessionId: options.sessionId,
          messageId: options.messageId,
          modelId: options.modelId,
          systemPrompt: options.systemPrompt,
          providerOverrides: options.providerOverrides,
          workingMessages: [...options.workingMessages],
          pendingTool: {
            toolCallId: toolCall.id,
            bindingName: toolInfo.bindingName,
            toolName: toolInfo.toolName,
            serverName: toolInfo.serverName,
            input: toolCall.args,
            approvalMode: toolInfo.binding.approvalMode,
            requestedAt: nowIso(),
            rawArguments: toolCall.rawArguments,
          },
        });
        yield approvalRequiredEvent({
          runId: options.runId,
          messageId: options.messageId,
          toolCallId: toolCall.id,
          toolName: toolInfo.toolName,
          serverName: toolInfo.serverName,
          input: toolCall.args,
          approvalMode: toolInfo.binding.approvalMode,
        });
        yield messageEndEvent(options.messageId, "approval_required");
        return;
      }

      yield toolStartEvent({
        runId: options.runId,
        messageId: options.messageId,
        toolCallId: toolCall.id,
        toolName: toolInfo.toolName,
        serverName: toolInfo.serverName,
        input: toolCall.args,
      });

      if (!toolInfo.binding) {
        const errorMessage = `Tool not found: ${toolInfo.toolName}`;
        options.workingMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: errorMessage,
        });
        yield toolResultEvent({
          runId: options.runId,
          messageId: options.messageId,
          toolCallId: toolCall.id,
          toolName: toolInfo.toolName,
          serverName: toolInfo.serverName,
          output: { error: errorMessage },
          display: errorMessage,
          status: "error",
        });
        continue;
      }

      try {
        const result = await executeToolCall(toolInfo.binding.tool, {
          id: toolCall.id,
          name: toolInfo.binding.bindingName,
          args: toolCall.args as Record<string, unknown>,
          type: "tool_call",
        });
        options.workingMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result.display,
        });
        yield toolResultEvent({
          runId: options.runId,
          messageId: options.messageId,
          toolCallId: toolCall.id,
          toolName: toolInfo.toolName,
          serverName: toolInfo.serverName,
          output: result.output,
          display: result.display,
          status: result.status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tool execution failed";
        options.workingMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: message,
        });
        yield toolResultEvent({
          runId: options.runId,
          messageId: options.messageId,
          toolCallId: toolCall.id,
          toolName: toolInfo.toolName,
          serverName: toolInfo.serverName,
          output: { error: message },
          display: message,
          status: "error",
        });
      }
    }
  }
}

async function* resumeFromPendingRun(record: PendingRunRecord): AsyncGenerator<ChatStreamEvent> {
  const toolBindings = await loadMcpToolBindings();
  if (record.kind === "deepseek") {
    yield* runDeepSeekReasoningAgentLoop({
      runId: record.runId,
      sessionId: record.sessionId,
      messageId: record.messageId,
      modelId: record.modelId,
      systemPrompt: record.systemPrompt,
      providerOverrides: record.providerOverrides,
      toolBindings,
      workingMessages: [...record.workingMessages],
      pendingTool: record.pendingTool,
    });
    return;
  }

  yield* runStandardAgentLoop({
    runId: record.runId,
    sessionId: record.sessionId,
    messageId: record.messageId,
    modelId: record.modelId,
    systemPrompt: record.systemPrompt,
    providerOverrides: record.providerOverrides,
    toolBindings,
    workingMessages: [...record.workingMessages],
    pendingTool: record.pendingTool,
  });
}

export async function* runAgentStream(request: AgentChatRequest): AsyncGenerator<ChatStreamEvent> {
  const runId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const sessionId = request.sessionId || "default";

  yield {
    event: "message_start",
    data: {
      runId,
      sessionId,
      messageId,
      role: "assistant",
      timestamp: nowIso(),
    },
  };

  try {
    if (isDeepSeekReasoningModel(request.modelId)) {
      yield* runDeepSeekReasoningAgentLoop({
        runId,
        sessionId,
        messageId,
        modelId: request.modelId,
        systemPrompt: request.systemPrompt,
        providerOverrides: request.providerOverrides,
        toolBindings: request.tools ?? [],
        workingMessages: toDeepSeekMessages(request.messages, request.systemPrompt),
      });
      return;
    }

    yield* runStandardAgentLoop({
      runId,
      sessionId,
      messageId,
      modelId: request.modelId,
      systemPrompt: request.systemPrompt,
      providerOverrides: request.providerOverrides,
      toolBindings: request.tools ?? [],
      workingMessages: toLangChainMessages(request.messages, request.systemPrompt),
    });
  } catch (error) {
    yield errorEvent(messageId, error instanceof Error ? error.message : "Chat stream failed");
    yield messageEndEvent(messageId, "error");
  }
}

export async function* resumePendingRunStream(runId: string): AsyncGenerator<ChatStreamEvent> {
  const record = beginPendingRunResume(runId);
  deletePendingRun(runId);

  try {
    yield* resumeFromPendingRun(record);
  } catch (error) {
    yield errorEvent(record.messageId, error instanceof Error ? error.message : "Chat stream failed");
    yield messageEndEvent(record.messageId, "error");
  }
}
