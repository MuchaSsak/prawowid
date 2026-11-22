# 015: No WhatsApp channel
Date: 2026-11-22 · Status: decided (user: "nie mamy operatora whatsapp wiec trzeba wywalic wszedzie")

Context: the bot ([decision 007](007-messaging-bot-chat-sdk.md)) had a WhatsApp adapter, and the cost sheet and deck counted a WhatsApp operator fee. We have no WhatsApp operator (no Meta business number), so the channel can't run and its cost line was fiction.

Decision:
- WhatsApp is removed from the code: the `@chat-adapter/whatsapp` dependency, the adapter and message handling in `apps/bot`, the `WHATSAPP_*` env vars in `.env.example`, the WhatsApp e2e test, and `whatsapp` in `MESSAGING_PLATFORMS` (`packages/core/src/types.ts`). `/webhooks/whatsapp` now answers 404 like any unknown platform.
- The API still accepts an unknown `platform` value and drops it from the log row, so contract v1 stays additive ([decision 006](006-api-contract-v1-and-mock.md)).
- Channels are: web, Discord, Messenger. All have a $0 operator fee.
- The cost sheet lost its two WhatsApp rows; the deck says "Strona, Discord i Messenger".

Affects: [architecture/messaging-bot.md](../architecture/messaging-bot.md), [architecture/messaging-bot-runbook.md](../architecture/messaging-bot-runbook.md), [rules/cost-sheet.md](../rules/cost-sheet.md), [hackathon/deliverables.md](../hackathon/deliverables.md), [pitch/deck.md](../pitch/deck.md).
