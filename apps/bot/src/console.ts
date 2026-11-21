/**
 * Console channel: the bot's real conversation (intake, API client, validator, sanitizer, render)
 * run from a terminal, with no platform account and no client key (it uses the API's per-IP limit).
 * It is the demo adapter the jury can run from the README.
 *
 *   bun run bot:console                              interactive: type a message, get the reply
 *   bun run bot:console "Ceny prądu wzrosły o 300%"  one message, then exit
 *   bun run bot:console --as discord "demo:mixed"    render the way Discord would show it
 *   bun run bot:console --image zrzut.png "czy to prawda?"
 *   bun run bot:console --json "…"                   print the reply and its outcome as JSON
 *
 * Env: PRAWDOWID_API_URL (default: the deployed API), PRAWDOWID_WEB_URL. No secrets needed.
 */
import { createClient } from "./client.ts";
import { loadConfig, PLATFORMS, type Surface } from "./config.ts";
import { converse, type Reply } from "./conversation.ts";
import type { IncomingMessage } from "./intake.ts";
import { resolveIdSecret } from "./pseudonym.ts";

const args = process.argv.slice(2);
function takeFlag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
function takeBool(name: string): boolean {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
}

const as = takeFlag("--as") as Surface | undefined;
const imagePath = takeFlag("--image");
const json = takeBool("--json");
const surface: Surface = as && (PLATFORMS as string[]).includes(as) ? as : "console";

// No client key: the console is a public channel and must not borrow the bot's key.
const config = { ...loadConfig({ get: (k) => process.env[k] }), clientKey: undefined };
const deps = { config, client: createClient(config), idSecret: resolveIdSecret(config.idSecret, true) };

async function toMessage(text: string, image?: string): Promise<IncomingMessage> {
  if (!image) return { text };
  const file = Bun.file(image);
  return { text, image: { kind: "sdk", size: file.size, fetchData: () => file.arrayBuffer() } };
}

function print(reply: Reply) {
  if (json) console.log(JSON.stringify(reply));
  else console.log(reply.text ?? "(brak odpowiedzi)");
}

async function once(text: string, image?: string) {
  const reply = await converse({ surface, userId: "console-user", message: await toMessage(text, image) }, deps);
  print(reply);
  if (!json) console.error(`\n[${reply.outcome} · ${reply.text?.length ?? 0} znaków · api=${config.apiUrl} · ${surface}]`);
}

if (args.length > 0 || imagePath) {
  await once(args.join(" "), imagePath);
} else {
  console.log(`Prawdomat, kanał konsolowy (api=${config.apiUrl}). Wpisz wiadomość, „pomoc” albo Ctrl+D, żeby wyjść.`);
  process.stdout.write("> ");
  for await (const line of console) {
    if (line.trim()) await once(line);
    process.stdout.write("\n> ");
  }
}
