// deploy-commands.js
require("dotenv").config();
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID; // App ID (Developer Portal ? General Information)
const guildId = process.env.GUILD_ID;   // Optional: für Gilden-Registrierung (schneller)

if (!token || !clientId) {
  console.error("Fehlende ENV Variablen. Bitte setze DISCORD_TOKEN und CLIENT_ID (optional GUILD_ID).");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("rollen")
    .setDescription("Listet Mitglieder je höchster Rolle (weitere Rollen in Klammern) und Gesamtanzahl")
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("?? Registriere Slash-Command...");
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`? Guild-Command registriert für Gilde ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log("? Globaler Command registriert (bis zu 1h Propagationszeit).");
    }
  } catch (err) {
    console.error("? Fehler beim Registrieren:", err);
  }
})();
