import { XRequest } from "@ant-design/x-sdk";
import type { ChatAgentMessage, ChatRequestInput, ChatSseChunk } from "./types";

export function createChatRequest() {
  return XRequest<ChatRequestInput, ChatSseChunk, ChatAgentMessage>("/api/chat", {
    manual: true,
    method: "POST",
    streamTimeout: 5 * 60 * 1000,
  });
}

async function readJsonError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return typeof data?.error === "string" ? data.error : "请求失败";
}

export async function* streamPendingRunResume(runId: string): AsyncGenerator<ChatSseChunk> {
  const res = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(await readJsonError(res));
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent: ChatSseChunk = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (!line) {
        if (currentEvent.event || currentEvent.data) {
          yield currentEvent;
        }
        currentEvent = {};
        continue;
      }

      if (line.startsWith("event: ")) {
        currentEvent.event = line.slice(7);
        continue;
      }

      if (line.startsWith("data: ")) {
        currentEvent.data = currentEvent.data ? `${currentEvent.data}\n${line.slice(6)}` : line.slice(6);
      }
    }
  }

  if (currentEvent.event || currentEvent.data) {
    yield currentEvent;
  }
}
