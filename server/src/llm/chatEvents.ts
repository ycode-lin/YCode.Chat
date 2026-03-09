export interface ChatUsagePayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  raw?: unknown;
}

export type ChatStreamEvent =
  | {
      event: "message_start";
      data: {
        runId: string;
        sessionId: string;
        messageId: string;
        role: "assistant";
        timestamp: string;
      };
    }
  | {
      event: "text_delta";
      data: {
        messageId: string;
        delta: string;
      };
    }
  | {
      event: "reasoning_delta";
      data: {
        messageId: string;
        delta: string;
      };
    }
  | {
      event: "tool_approval_required";
      data: {
        runId: string;
        messageId: string;
        toolCallId: string;
        toolName: string;
        serverName: string;
        input: unknown;
        approvalMode: "manual" | "solo";
        timestamp: string;
      };
    }
  | {
      event: "tool_approval_resolved";
      data: {
        runId: string;
        messageId: string;
        toolCallId: string;
        toolName: string;
        serverName: string;
        decision: "approve" | "deny";
        timestamp: string;
      };
    }
  | {
      event: "tool_start";
      data: {
        runId: string;
        messageId: string;
        toolCallId: string;
        toolName: string;
        serverName: string;
        input: unknown;
        timestamp: string;
      };
    }
  | {
      event: "tool_result";
      data: {
        runId: string;
        messageId: string;
        toolCallId: string;
        toolName: string;
        serverName: string;
        output: unknown;
        display: string;
        status: "success" | "error" | "denied";
        timestamp: string;
      };
    }
  | {
      event: "message_end";
      data: {
        messageId: string;
        finishReason: string;
        usage?: ChatUsagePayload;
        timestamp: string;
      };
    }
  | {
      event: "error";
      data: {
        messageId?: string;
        code: string;
        message: string;
        timestamp: string;
      };
    };

export function formatSseEvent(event: ChatStreamEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
