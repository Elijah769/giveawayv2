const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    Collection
} = require('discord.js');
require('dotenv').config();
const fs = require('fs');

// ================= CONFIG =================
const LOG_CHANNEL_ID = '1459873973637611612';
const ALLOWED_ROLE_IDS = ['1459874963795345650', '1459875200069013597'];

const GIVEAWAY_FILE = './giveaways.json';
const BLACKLIST_FILE = './blacklist.json';

// ================= CLIENT =================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

client.giveaways = new Collection();

// ================= JSON UTILS =================
function loadJSON(path, def) {
    if (!fs.existsSync(path)) {
        fs.writeFileSync(path, JSON.stringify(def, null, 2));
        return def;
    }
    try {
        return JSON.parse(fs.readFileSync(path, 'utf8'));
    } catch {
        return def;
    }
}

function saveJSON(path, data) {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// ================= BLACKLIST =================
const rawBlacklist = loadJSON(BLACKLIST_FILE, []);
const blacklist = new Set(Array.isArray(rawBlacklist) ? rawBlacklist : []);

// ================= UTILS =================
function msToTime(ms) {
    const s = Math.floor((ms / 1000) % 60);
    const m = Math.floor((ms / 60000) % 60);
    const h = Math.floor((ms / 3600000) % 24);
    const d = Math.floor(ms / 86400000);
    return `${d}d ${h}h ${m}m ${s}s`;
}

function saveGiveaways() {
    const data = {};
    for (const [id, g] of client.giveaways) {
        data[id] = {
            prize: g.prize,
            participants: g.participants,
            endsAt: g.endsAt,
            channelId: g.channelId,
            numWinners: g.numWinners
        };
    }
    saveJSON(GIVEAWAY_FILE, data);
}

// ================= END GIVEAWAY =================
async function endGiveaway(g) {
    const channel = await client.channels.fetch(g.channelId);
    const message = await channel.messages.fetch(g.message.id);

    let winners = [];
    if (g.participants.length) {
        winners = [...g.participants]
            .sort(() => 0.5 - Math.random())
            .slice(0, g.numWinners)
            .map(id => channel.guild.members.cache.get(id))
            .filter(Boolean);
    }

    const embed = EmbedBuilder.from(message.embeds[0])
        .setTitle('⏰ GIVEAWAY TERMINÉ')
        .setDescription(
            winners.length
                ? ` Gagnants : ${winners.join(', ')}\n**Prix :** ${g.prize}`
                : ` Aucun gagnant\n**Prix :** ${g.prize}`
        )
        .setColor(winners.length ? 'Gold' : 'Grey')
        .setTimestamp();

    await message.edit({ embeds: [embed], components: [] });

    if (winners.length)
        channel.send(` Félicitations ${winners.join(', ')} !`);

    client.giveaways.delete(message.id);
    saveGiveaways();
}

// ================= READY =================
client.once('ready', async () => {
    console.log(`${client.user.tag} prêt !`);

    // 🔥 REGISTER SLASH COMMANDS
    await client.application.commands.set([
        {
            name: 'giveaway',
            description: 'Lancer un giveaway',
            options: [
                { name: 'prize', type: 3, description: 'Prix', required: true },
                { name: 'duration', type: 3, description: 'Durée (10s,5m,1h)', required: true },
                { name: 'numwinners', type: 4, description: 'Nombre de gagnants', required: false }
            ]
        },
        {
            name: 'end',
            description: 'Terminer un giveaway',
            options: [
                { name: 'messageid', type: 3, description: 'ID du message', required: true }
            ]
        },
        {
            name: 'giveaway-info',
            description: 'Infos sur un giveaway',
            options: [
                { name: 'messageid', type: 3, description: 'ID du message', required: true }
            ]
        },
        {
            name: 'blacklist',
            description: 'Gérer la blacklist',
            options: [
                { name: 'action', type: 3, description: 'add | remove | list', required: true },
                { name: 'user', type: 6, description: 'Utilisateur', required: false }
            ]
        }
    ], process.env.GUILD_ID);

    // 🔁 LOAD SAVED GIVEAWAYS
    const saved = loadJSON(GIVEAWAY_FILE, {});
    for (const id in saved) {
        try {
            const g = saved[id];
            const channel = await client.channels.fetch(g.channelId);
            const message = await channel.messages.fetch(id);

            client.giveaways.set(id, { ...g, message });

            const remaining = g.endsAt - Date.now();
            setTimeout(() => endGiveaway(client.giveaways.get(id)), Math.max(remaining, 0));
        } catch {}
    }
});

// ================= INTERACTIONS =================
client.on(Events.InteractionCreate, async interaction => {

    // ===== BUTTON =====
    if (interaction.isButton() && interaction.customId === 'enter_giveaway') {
        const g = client.giveaways.get(interaction.message.id);
        if (!g) return interaction.reply({ content: 'Giveaway terminé.', ephemeral: true });

        if (blacklist.has(interaction.user.id))
            return interaction.reply({ content: ' Tu es blacklist tu ne peut pas participer au gw.', ephemeral: true });

        if (g.participants.includes(interaction.user.id))
            return interaction.reply({ content: 'Déjà inscrit.', ephemeral: true });

        g.participants.push(interaction.user.id);
        saveGiveaways();

        const embed = EmbedBuilder.from(g.message.embeds[0])
            .setDescription(`**Prix :** ${g.prize}\n**Participants :** ${g.participants.length}\n🎁 Clique pour participer`);

        await g.message.edit({ embeds: [embed] });
        return interaction.reply({ content: ' Participation validée !', ephemeral: true });
    }

    if (!interaction.isCommand()) return;

    const roles = interaction.member.roles.cache.map(r => r.id);
    const isStaff = ALLOWED_ROLE_IDS.some(r => roles.includes(r));

    // ===== GIVEAWAY =====
    if (interaction.commandName === 'giveaway') {
        if (!isStaff) return interaction.reply({ content: ' Permission refusée.', ephemeral: true });

        const prize = interaction.options.getString('prize');
        const durationInput = interaction.options.getString('duration');
        const numWinners = interaction.options.getInteger('numwinners') || 1;

        const match = durationInput.match(/^(\d+)([smhd])$/);
        if (!match) return interaction.reply({ content: 'Durée invalide.', ephemeral: true });

        const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
        const duration = parseInt(match[1]) * mult[match[2]];

        const embed = new EmbedBuilder()
            .setTitle('🎁 GIVEAWAY')
            .setDescription(`**Prix :** ${prize}\n**Participants :** 0\n🎁 Clique pour participer`)
            .setColor('Random');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('enter_giveaway')
                .setLabel('Participer')
                .setStyle(ButtonStyle.Success)
        );

        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

        client.giveaways.set(msg.id, {
            prize,
            participants: [],
            endsAt: Date.now() + duration,
            channelId: interaction.channel.id,
            numWinners,
            message: msg
        });

        saveGiveaways();
        setTimeout(() => endGiveaway(client.giveaways.get(msg.id)), duration);

        interaction.reply({ content: ' Giveaway lancé !', ephemeral: true });
    }

    // ===== END =====
    if (interaction.commandName === 'end') {
        if (!isStaff) return interaction.reply({ content: ' Permission refusée.', ephemeral: true });

        const g = client.giveaways.get(interaction.options.getString('messageid'));
        if (!g) return interaction.reply({ content: 'Introuvable.', ephemeral: true });

        await endGiveaway(g);
        interaction.reply({ content: '⏹ Giveaway terminé.', ephemeral: true });
    }

    // ===== INFO =====
    if (interaction.commandName === 'giveaway-info') {
        const g = client.giveaways.get(interaction.options.getString('messageid'));
        if (!g) return interaction.reply({ content: 'Introuvable.', ephemeral: true });

        interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🎁 Giveaway Info')
                    .addFields(
                        { name: 'Prix', value: g.prize, inline: true },
                        { name: 'Participants', value: `${g.participants.length}`, inline: true },
                        { name: 'Temps restant', value: msToTime(g.endsAt - Date.now()) }
                    )
            ],
            ephemeral: true
        });
    }

    // ===== BLACKLIST =====
    if (interaction.commandName === 'blacklist') {
        if (!isStaff) return interaction.reply({ content: ' Permission refusée.', ephemeral: true });

        const action = interaction.options.getString('action');
        const user = interaction.options.getUser('user');

        if (action === 'add' && user) blacklist.add(user.id);
        if (action === 'remove' && user) blacklist.delete(user.id);

        saveJSON(BLACKLIST_FILE, [...blacklist]);
        interaction.reply({ content: ' Blacklist mise à jour.', ephemeral: true });
    }
});

// ================= LOGIN =================
client.login(process.env.TOKEN);
