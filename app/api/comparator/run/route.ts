import { NextResponse } from "next/server";

import { runProvider } from "@/lib/comparator/adapters";
import {
  isProviderId,
  type AdapterEvent,
  type ComparatorRunRequest,
} from "@/lib/comparator/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "요청 본문을 읽을 수 없습니다.",
        },
      },
      { status: 400 },
    );
  }

  const input = normalizeRunRequest(payload);
  if (!input) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "요청 형식이 올바르지 않습니다.",
        },
      },
      { status: 400 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runProvider(input)) {
          controller.enqueue(encodeEvent(event));
        }
      } catch (error) {
        controller.enqueue(
          encodeEvent({
            type: "error",
            runId: input.runId,
            cardId: input.cardId,
            error: {
              code: "unknown_error",
              message:
                error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
              retryable: true,
            },
            occurredAt: new Date().toISOString(),
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeRunRequest(payload: unknown): ComparatorRunRequest | null {
  if (!isRecord(payload)) {
    return null;
  }

  const provider = typeof payload.provider === "string" ? payload.provider : "";

  if (
    typeof payload.runId !== "string" ||
    typeof payload.cardId !== "string" ||
    typeof payload.model !== "string" ||
    typeof payload.prompt !== "string" ||
    !isProviderId(provider)
  ) {
    return null;
  }

  const apiKey =
    typeof payload.apiKey === "string" ? payload.apiKey : payload.apiKey === null ? null : null;
  const systemPrompt =
    typeof payload.systemPrompt === "string"
      ? payload.systemPrompt
      : payload.systemPrompt === null
        ? null
        : null;

  const options = isRecord(payload.options) ? payload.options : {};

  return {
    runId: payload.runId,
    cardId: payload.cardId,
    provider,
    model: payload.model,
    apiKey,
    prompt: payload.prompt,
    systemPrompt,
    options: {
      stream: typeof options.stream === "boolean" ? options.stream : true,
      temperature: typeof options.temperature === "number" ? options.temperature : 0.8,
      maxTokens: typeof options.maxTokens === "number" ? options.maxTokens : 768,
    },
  };
}

function encodeEvent(event: AdapterEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
