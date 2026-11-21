/**
 * OpenRouter chat completions with a strict JSON schema, validated again in code with zod.
 * Invalid output → one retry → LlmError (the caller turns it into a system state, never a verdict).
 */
import { z } from "zod";
import { routingFor } from "../config.ts";

export type LlmErrorKind = "missing_key" | "timeout" | "rate_limited" | "http" | "invalid_output";

export class LlmError extends Error {
  constructor(public kind: LlmErrorKind, message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmUsage {
  model: string;
  provider: string | null;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface ChatJsonOptions<T extends z.ZodType> {
  apiKey: string | undefined;
  model: string;
  system: string;
  user: string | ContentPart[];
  schemaName: string;
  schema: T;
  timeoutMs: number;
  maxTokens?: number;
  /** Aborts when the whole request runs out of time. */
  signal?: AbortSignal;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** zod → JSON schema for `response_format` (strict mode wants no $schema key). */
export function toResponseSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : t;
}

async function once<T extends z.ZodType>(opts: ChatJsonOptions<T>): Promise<{ data: z.infer<T>; usage: LlmUsage }> {
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Prawdowid",
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 2500,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.schemaName, strict: true, schema: toResponseSchema(opts.schema) },
        },
        provider: { ...routingFor(opts.model), require_parameters: true },
        usage: { include: true },
      }),
    });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new LlmError("timeout", `${opts.schemaName}: model timed out`);
    }
    throw new LlmError("http", `${opts.schemaName}: network error: ${(err as Error).message}`);
  }

  const body = await res.text();
  if (res.status === 429) throw new LlmError("rate_limited", `${opts.schemaName}: OpenRouter 429`);
  if (!res.ok) throw new LlmError("http", `${opts.schemaName}: OpenRouter ${res.status}: ${body.slice(0, 300)}`);

  let payload: {
    model?: string;
    provider?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  try {
    payload = JSON.parse(body);
  } catch {
    throw new LlmError("invalid_output", `${opts.schemaName}: non-JSON response from OpenRouter`);
  }
  if (payload.error) throw new LlmError("http", `${opts.schemaName}: ${payload.error.message ?? "provider error"}`);

  const content = payload.choices?.[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch {
    throw new LlmError("invalid_output", `${opts.schemaName}: model did not return JSON`);
  }
  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    throw new LlmError("invalid_output", `${opts.schemaName}: schema mismatch: ${result.error.message.slice(0, 300)}`);
  }
  return {
    data: result.data,
    usage: {
      model: payload.model ?? opts.model,
      provider: payload.provider ?? null,
      cost_usd: payload.usage?.cost ?? 0,
      prompt_tokens: payload.usage?.prompt_tokens ?? 0,
      completion_tokens: payload.usage?.completion_tokens ?? 0,
    },
  };
}

/** One call, one retry on invalid output or a transient error. */
export async function chatJson<T extends z.ZodType>(
  opts: ChatJsonOptions<T>,
): Promise<{ data: z.infer<T>; usage: LlmUsage }> {
  if (!opts.apiKey) throw new LlmError("missing_key", "OPENROUTER_API_KEY is not set");
  try {
    return await once(opts);
  } catch (err) {
    const retryable = err instanceof LlmError && (err.kind === "invalid_output" || err.kind === "http");
    if (!retryable || opts.signal?.aborted) throw err;
    return await once(opts);
  }
}
