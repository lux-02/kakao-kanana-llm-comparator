import type {
  AdapterEvent,
  ComparatorRunRequest,
} from "@/lib/comparator/contracts";

export async function* runComparatorRequest(
  requestBody: ComparatorRunRequest,
): AsyncGenerator<AdapterEvent> {
  const response = await fetch("/api/comparator/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "요청에 실패했습니다.");
  }

  if (!response.body) {
    throw new Error("응답 스트림을 읽을 수 없습니다.");
  }

  yield* readAdapterEventStream(response.body);
}

async function* readAdapterEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AdapterEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const event = parseAdapterEvent(trimmed);
      if (event) {
        yield event;
      }
    }
  }

  const trailing = buffer.trim();
  if (!trailing) {
    return;
  }

  const event = parseAdapterEvent(trailing);
  if (event) {
    yield event;
  }
}

function parseAdapterEvent(value: string): AdapterEvent | null {
  try {
    return JSON.parse(value) as AdapterEvent;
  } catch {
    return null;
  }
}
