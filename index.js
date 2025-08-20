require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,    // Mitglieder & Rollen
    GatewayIntentBits.GuildMessages,   // Nachrichten-Events
    GatewayIntentBits.MessageContent   // Nachrichtentext (für !check)
  ]
});

client.once("ready", () => {
  console.log(`? Eingeloggt als ${client.user.tag}`);
});

// ---- Helfer ----
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function buildRoleEmbeds(guild, client) {
  // Mitglieder laden (setzt SERVER MEMBERS INTENT im Developer-Portal voraus)
  await guild.members.fetch();

  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone")
    .sort((a, b) => b.position - a.position);

  const assigned = new Set();
  const embeds = [];

  for (const role of roles.values()) {
    const membersForThisRole = role.members.filter(m =>
      !m.user.bot &&
      m.id !== client.user.id &&
      !assigned.has(m.id)
    );

    if (membersForThisRole.size === 0) continue;

    const lines = membersForThisRole
      .map(m => {
        const otherRoles = m.roles.cache
          .filter(r => r.name !== "@everyone" && r.id !== role.id)
          .sort((a, b) => b.position - a.position)
          .map(r => r.name);

        assigned.add(m.id);
        const suffix = otherRoles.length ? ` (weitere: ${otherRoles.join(", ")})` : "";
        return `- ${m.displayName}${suffix}`; // Nickname/Servername
      })
      .sort((a, b) => a.localeCompare(b, "de"));

    // Große Listen aufteilen (Embed-Limit 4096 Zeichen)
    const descriptionChunks = [];
    let current = [];
    let length = 0;
    for (const line of lines) {
      const addLen = line.length + 1;
      if (length + addLen > 3800) {
        descriptionChunks.push(current.join("\n"));
        current = [line];
        length = addLen;
      } else {
        current.push(line);
        length += addLen;
      }
    }
    if (current.length) descriptionChunks.push(current.join("\n"));

    for (let i = 0; i < descriptionChunks.length; i++) {
      const part = descriptionChunks.length > 1 ? ` (${i + 1}/${descriptionChunks.length})` : "";
      const embed = new EmbedBuilder()
        .setTitle(`${role.name}${part}`)
        .setColor(role.color || 0x2f3136)
        .setDescription(descriptionChunks[i])
        .setFooter({ text: `Mitglieder in dieser Liste: ${lines.length}` });
      embeds.push(embed);
    }
  }

  return { embeds, total: assigned.size };
}

// ---- Message-Handler: !check (mit kleinen Debugs) ----
client.on("messageCreate", async (message) => {
  // Debug: zeigt ankommende Nachrichten
  console.log(
    "msg:",
    message.inGuild() ? `${message.guild?.name}#${message.channel?.name}` : "DM",
    "| from:", message.author?.tag,
    "| content:", JSON.stringify(message.content)
  );

  if (!message.inGuild()) return;
  if (message.author.bot) return;

  const txt = message.content.trim();
  if (!/^!check(\b|$)/i.test(txt)) return;

  // Rechte im Kanal prüfen
  const perms = message.channel.permissionsFor(message.guild.members.me);
  if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) {
    return console.log("?? Keine ViewChannel-Permission.");
  }
  if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
    return console.log("?? Keine SendMessages-Permission.");
  }

  const canEmbed = perms.has(PermissionsBitField.Flags.EmbedLinks);

  try {
    await message.channel.send("? Erstelle Rollenübersicht…");

    const { embeds, total } = await buildRoleEmbeds(message.guild, client);

    if (embeds.length === 0) {
      return message.channel.send("Keine (nicht-Bot) Mitglieder mit Rollen gefunden.");
    }

    if (canEmbed) {
      const batches = chunk(embeds, 10);
      for (const batch of batches) {
        await message.channel.send({ embeds: batch });
      }
    } else {
      // Fallback ohne Embed-Recht
      for (const e of embeds) {
        await message.channel.send(`**${e.data.title}**\n${e.data.description}`);
      }
    }

    await message.channel.send(`**Gesamt:** ${total} Mitglieder`);
  } catch (err) {
    console.error("? Fehler bei !check:", err);
    await message.channel.send("Fehler beim Erstellen der Rollenübersicht. Prüfe Intents & Rechte.");
  }
});

// ---- Login ----
const token = (process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error("? Kein Token gefunden! Setze DISCORD_TOKEN in .env oder Railway Variables.");
  process.exit(1);
}
client.login(token);
