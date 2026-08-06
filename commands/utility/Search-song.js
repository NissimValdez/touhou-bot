const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { searchSongs } = require('../../touhoudb-api.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search-song')
        .setDescription('Search for a song')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song title or keyword(s)')
                .setRequired(true)
        ),
    
    async execute(interaction) {
        await interaction.deferReply();

        const query = interaction.options.getString('query');

        try {
            const data = await searchSongs(query, {
                maxResults: 5,
                fields: 'Artists,PVs,Albums',
                lang: 'Default'
            });

            if (!data.items || data.items.length === 0) {
                return await interaction.editReply(`No songs found for "${query}"`);
            }

            const embed = new EmbedBuilder()
                .setTitle(`Results for "${query}"`)
                .setColor(0x2596BE)
                .setFooter({
                    text: `Showing ${data.items.length} of ${data.totalCount || data.items.length} results from TouhouDB`,
                });
            
            data.items.forEach((song, index) => {
                const artists = song.artists && song.artists.length > 0
                    ? song.artists.map(a => a.name).join(', ')
                    : 'Unknown Artist';

                let details = `${artists}`;

                if (song.publishDate) {
                    details += `\n ${song.publishDate}`;
                }

                if (song.lengthSeconds) {
                    const minutes = Math.floor(song.lengthSeconds/60);
                    const seconds = song.lengthSeconds % 60;
                    details += `\n ${minutes}:${seconds.toString().padStart(2, '0')}`;
                }

                if (song.albums && song.albums.length > 0) {
                    const album = song.albums[0];
                    details += `\n ${album.name || 'Unknown Album'}`;
                }

                details += `\n [View on TouhouDB](https://touhoudb.com/S/${song.id})`;

                embed.addFields({
                    name: `${index + 1}. ${song.name}`,
                    value: details,
                    inline: false
                });
            });

            await interaction.editReply({ embeds: [embed]});

        } catch (error) {
            console.error('Search error: ', error);

            if (error.message.includes('Rate limit')) {
                await interaction.editReply('Rate limit exceeded. Please wait a moment and try again.');
            } else {
                await interaction.editReply('Failed to search for songs. Please try again later.');
            }
        }
    }
};