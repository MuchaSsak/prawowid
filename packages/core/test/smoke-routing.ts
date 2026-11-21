// Manual smoke test: does OpenRouter accept our provider pinning? Prints model + provider, never the key.
// Run: deno run --allow-net --allow-env --env-file=.env packages/core/test/smoke-routing.ts
import { z } from "zod";
import { chatJson } from "../src/llm/openrouter.ts";
import { DEFAULT_MODELS } from "../src/config.ts";

const r = await chatJson({
  apiKey: Deno.env.get("OPENROUTER_API_KEY"),
  model: DEFAULT_MODELS.claim_extraction,
  system: "Return JSON only.",
  user: 'Return {"ok": true, "word": "<any Polish word>"}',
  schemaName: "smoke",
  schema: z.strictObject({ ok: z.boolean(), word: z.string() }),
  timeoutMs: 20_000,
});
console.log(JSON.stringify({ data: r.data, model: r.usage.model, provider: r.usage.provider, cost: r.usage.cost_usd }));
