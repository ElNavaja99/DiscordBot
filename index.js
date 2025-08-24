// --- ENV laden ---
require("dotenv").config();

const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");

// ==== KONFIG AUS ENV ====
const GOODBYE_CHANNEL_ID = (process.env.GOODBYE_CHANNEL_ID || "").trim();
const WELCOME_CHANNEL_ID = (process.env.WELCOME_CHANNEL_ID || "").trim();
// Mehrere Rollen-IDs per Komma getrennt: WELCOME_ROLE_IDS=ID1,ID2,ID3
const WELCOME_ROLE_IDS = (process.env.WELCOME_ROLE_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ==== CLIENT ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,                // Server-Infos
    GatewayIntentBits.GuildMembers,          // Join/Leave + Rollen
    GatewayIntentBits.GuildMessages,         // Nachrichten-Events
    GatewayIntentBits.MessageContent,        // Inhalt (für !-Befehle)
    GatewayIntentBits.GuildMessageReactions  // Reaktionen (für !reactcheck)
  ]
});

client.once("ready", () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
});

// ==== Hilfsfunktionen ====
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toFieldChunks(arr, label) {
  if (arr.length === 0) return [{ name: label, value: "—", inline: false }];
  const chunks = [];
  let current = [];
  let len = 0;
  for (const name of arr) {
    const piece = `- ${name}`; // ASCII-Bullet
    if (len + piece.length + 1 > 1000 || current.length >= 25) {
      chunks.push(current.join("\n"));
      current = [piece];
      len = piece.length + 1;
    } else {
      current.push(piece);
      len += piece.length + 1;
    }
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks.map((v, i) => ({
    name: `${label}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ""}`,
    value: v,
    inline: false
  }));
}

// ==== !check: Rollenübersicht ====
async function buildRoleEmbeds(guild) {
  await guild.members.fetch();

  const roles = guild.roles.cache
    .filter(r => r.name !== "@everyone")
    .sort((a, b) => b.position - a.position);

  const assigned = new Set();
  const embeds = [];

  for (const role of roles.values()) {
    const membersForThisRole = role.members.filter(m =>
      !m.user.bot && !assigned.has(m.id)
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
        return `- ${m.displayName}${suffix}`;
      })
      .sort((a, b) => a.localeCompare(b, "de"));

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

// ==== MESSAGE HANDLER ====
client.on("messageCreate", async (message) => {
  if (!message.inGuild() || message.author.bot) return;
  const content = message.content.trim();

  // ---- !check ----
  if (/^!check(\b|$)/i.test(content)) {
    try {
      await message.channel.send("⏳ Erstelle Rollenübersicht…");
      const { embeds, total } = await buildRoleEmbeds(message.guild);
      if (embeds.length === 0) {
        return message.channel.send("Keine (nicht-Bot) Mitglieder mit Rollen gefunden.");
      }
      const batches = chunk(embeds, 10);
      for (const batch of batches) {
        await message.channel.send({ embeds: batch });
      }
      await message.channel.send(`**Gesamt:** ${total} Mitglieder`);
    } catch (err) {
      console.error("❌ Fehler bei !check:", err);
      await message.channel.send("Fehler beim Erstellen der Rollenübersicht.");
    }
    return;
  }

  // ---- !reactcheck ----
  const parts = content.split(/\s+/);
  if (parts[0]?.toLowerCase() === "!reactcheck") {
    if (!parts[1]) {
      return message.reply("Nutze: `!reactcheck <Nachrichten-Link oder -ID> [Rollenname optional]`");
    }

    const resolveMessageFromArg = async (guild, invokingChannel, raw) => {
      const linkRe = /discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
      const m = raw.match(linkRe);
      let channelId, messageId;
      if (m) {
        const [, guildId, chId, msgId] = m;
        if (guildId !== guild.id) throw new Error("Der Link gehört zu einem anderen Server.");
        channelId = chId; messageId = msgId;
      } else {
        channelId = invokingChannel.id; messageId = raw;
      }
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) throw new Error("Channel nicht gefunden.");
      const targetMessage = await channel.messages.fetch(messageId).catch(() => null);
      if (!targetMessage) throw new Error("Nachricht nicht gefunden.");
      return { channel, message: targetMessage };
    };

    const collectUsersForReaction = async (reaction) => {
      const ids = new Set();
      let lastId = undefined;
      while (true) {
        const batch = await reaction.users.fetch({ limit: 100, after: lastId }).catch(() => null);
        if (!batch || batch.size === 0) break;
        for (const user of batch.values()) {
          if (!user.bot) ids.add(user.id);
          lastId = user.id;
        }
        if (batch.size < 100) break;
      }
      return ids;
    };

    const roleNameArg = parts.length >= 3 ? content.split(/\s+/).slice(2).join(" ") : null;

    try {
      const { channel: targetChannel, message: targetMessage } =
        await resolveMessageFromArg(message.guild, message.channel, parts[1]);

      await message.guild.members.fetch();
      let targetMembers = message.guild.members.cache.filter(m => !m.user.bot);

      if (roleNameArg) {
        const role =
          message.guild.roles.cache.find(r => r.name.toLowerCase() === roleNameArg.toLowerCase());
        if (!role) return message.reply(`Rolle **${roleNameArg}** nicht gefunden.`);
        targetMembers = role.members.filter(m => !m.user.bot);
      }

      const reactions = targetMessage.reactions.cache;
      const yesReaction = reactions.find(r => r.emoji.name === "✅" || r.emoji.name === "\u2705");
      const noReaction  = reactions.find(r => r.emoji.name === "❌" || r.emoji.name === "\u274C");

      if (!yesReaction || !noReaction) {
        return message.reply("Bitte benutze genau :white_check_mark: (Ja) und :x: (Nein).");
      }

      const yesIds = await collectUsersForReaction(yesReaction);
      const noIds  = await collectUsersForReaction(noReaction);

      const yes = [], no = [], both = [], none = [];
      for (const m of targetMembers.values()) {
        const y = yesIds.has(m.id);
        const n = noIds.has(m.id);
        if (y && n) both.push(m.displayName);
        else if (y) yes.push(m.displayName);
        else if (n) no.push(m.displayName);
        else none.push(m.displayName);
      }

      const embed = new EmbedBuilder()
        .setTitle("Reaktions-Check (:white_check_mark: / :x:)")
        .setDescription(
          [
            `**Kanal:** <#${targetChannel.id}>`,
            `**Nachricht:** [Link](https://discord.com/channels/${message.guild.id}/${targetChannel.id}/${targetMessage.id})`,
            roleNameArg ? `**Zielgruppe:** Rolle **${roleNameArg}**` : "**Zielgruppe:** Alle Menschen",
            `**:white_check_mark: Ja:** ${yes.length}`,
            `**:x: Nein:** ${no.length}`,
            both.length ? `**KONFLIKT (beides):** ${both.length}` : null,
            `**Keine Stimme:** ${none.length}`
          ].filter(Boolean).join("\n")
        )
        .addFields([
          ...toFieldChunks(yes, ":white_check_mark: Ja"),
          ...toFieldChunks(no, ":x: Nein"),
          ...toFieldChunks(both, "KONFLIKT (beides)"),
          ...toFieldChunks(none, "Keine Stimme")
        ])
        .setColor(0x5865f2);

      await message.channel.send({ embeds: [embed] });
    } catch (err) {
      console.error("[!reactcheck] Fehler:", err);
      message.reply("Fehler bei !reactcheck. Prüfe Link/ID & Berechtigungen.");
    }
  }
});

// ==== LEAVE-EVENT ====
client.on("guildMemberRemove", async (member) => {
  try {
    if (!GOODBYE_CHANNEL_ID) return;
    const channel = member.guild.channels.cache.get(GOODBYE_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;
    await channel.send(`🚪 **${member.user.tag}** hat seinen/ihren Bloodout bekommen.`);
  } catch (err) {
    console.error("[guildMemberRemove] Fehler:", err);
  }
});

// ==== JOIN-EVENT: Welcome + mehrere Auto-Rollen ====
client.on("guildMemberAdd", async (member) => {
  try {
    // 1) Welcome-Text
    if (WELCOME_CHANNEL_ID) {
      const ch = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
      if (ch && ch.isTextBased()) {
        await ch.send(`🎉 Willkommen in der Familie, <@${member.id}>!`);
      }
    }

    // 2) Mehrere Rollen vergeben (falls konfiguriert)
    if (WELCOME_ROLE_IDS.length > 0) {
      const me = member.guild.members.me;
      const canManage = me && me.permissions.has(PermissionsBitField.Flags.ManageRoles);
      if (!canManage) {
        console.warn("[welcome] Bot hat keine Berechtigung 'Manage Roles'.");
        return;
      }

      for (const roleId of WELCOME_ROLE_IDS) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role) {
          console.warn(`[welcome] Rolle mit ID ${roleId} nicht gefunden.`);
          continue;
        }
        // Bot-Rolle muss höher stehen als Ziel-Rolle
        if (me.roles.highest.comparePositionTo(role) <= 0) {
          console.warn(`[welcome] Bot-Rolle steht nicht über '${role.name}'. Rollenreihenfolge prüfen.`);
          continue;
        }
        await member.roles.add(role, "Auto-Rolle beim Join");
      }
    }
  } catch (err) {
    console.error("[guildMemberAdd] Fehler:", err);
  }
});

// ==== LOGIN ====
const token = (process.env.DISCORD_TOKEN || "").trim();
if (!token) {
  console.error("❌ Kein Token gefunden! Setze DISCORD_TOKEN in .env");
  process.exit(1);
}
client.login(token);

process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);
