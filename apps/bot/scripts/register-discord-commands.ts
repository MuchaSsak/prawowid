/**
 * Registers /sprawdz, /pomoc and /usun-dane on one Discord server (guild commands show up at once;
 * global ones can take up to an hour). Run after creating the app, and after changing a command:
 *
 *   bun run bot:discord:commands
 *
 * Reads DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID from .env. Prints names only.
 * The PUT replaces the server's whole command list, so a removed command (the old /demo) disappears.
 */
export {};

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!appId || !token || !guildId) {
  console.error("Set DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID first.");
  process.exit(1);
}

const STRING = 3;
const ATTACHMENT = 11;
const commands = [
  {
    name: "sprawdz",
    description: "Sprawdź twierdzenia o faktach w tekście, linku albo zrzucie ekranu",
    options: [
      { type: STRING, name: "tresc", description: "Tekst albo link do sprawdzenia", required: false, max_length: 6000 },
      { type: ATTACHMENT, name: "obraz", description: "Zrzut ekranu (JPG, PNG, WebP, maks. 5 MB)", required: false },
    ],
  },
  { name: "pomoc", description: "Jak działa Prawdomat i jak chronimy Twoje dane" },
  { name: "usun-dane", description: "Usuń moje zapisane sprawdzenia" },
];

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
if (!res.ok) {
  console.error(`Discord answered HTTP ${res.status}`);
  process.exit(1);
}
console.log("Registered:", commands.map((c) => `/${c.name}`).join(", "));
