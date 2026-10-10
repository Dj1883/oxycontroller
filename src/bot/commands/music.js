const { SlashCommandBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const music = require('../../services/music');
const { text, separator, row, button, v2Payload, modalWithText } = require('../../utils/components');

function panel(i, notice = '') {
  const s = music.snapshot(i.guildId);
  const track = s?.current;
  const body = track
    ? `**${track.title}** — ${track.author}\n${s.paused ? '⏸️ Paused' : '▶️ Playing'} • ${music.formatDuration(s.position)} / ${track.durationText}\nQueue: ${s.queue.length} • Volume: ${s.volume}% • Loop: ${s.repeatMode}`
    : 'Nothing is currently playing.\nUse **Play** to search for a track.';

  return v2Payload([
    { type: 'text', value: `## 🎵 Oxy Music\n\n${notice ? `${notice}\n\n` : ''}${body}` },
    { type: 'separator', value: separator() },
    { type: 'row', value: row([
      button('music:play', 'Play', ButtonStyle.Primary),
      button('music:pause', 'Pause'),
      button('music:resume', 'Resume'),
      button('music:skip', 'Skip'),
      button('music:previous', 'Previous')
    ]) },
    { type: 'row', value: row([
      button('music:stop', 'Stop', ButtonStyle.Danger),
      button('music:leave', 'Leave'),
      button('music:queue', 'Queue'),
      button('music:shuffle', 'Shuffle'),
      button('music:loop', 'Loop')
    ]) },
    { type: 'row', value: row([
      button('music:volume', 'Volume'),
      button('music:seek', 'Seek'),
      button('music:remove', 'Remove'),
      button('music:clearqueue', 'Clear Queue')
    ]) }
  ], { ephemeral: true });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Open the Oxy music control panel'),

  async execute(i) {
    if (!i.guild) return i.reply(v2Payload([{ type: 'text', value: text('Music is only available inside a server.') }], { ephemeral: true }));
    return i.reply(panel(i));
  },

  async handleButton(i) {
    if (!i.customId.startsWith('music:')) return false;
    const action = i.customId.split(':')[1];

    try {
      if (action === 'play') return i.showModal(modalWithText({ customId: 'music:playmodal', title: 'Play Music', label: 'Song, artist or URL', description: 'Search YouTube or provide a direct supported URL.', inputId: 'query', placeholder: 'Ren - Hi Ren', maxLength: 500 }));
      if (action === 'volume') return i.showModal(modalWithText({ customId: 'music:volumemodal', title: 'Set Volume', label: 'Volume', description: 'Enter a value from 0 to 100.', inputId: 'level', placeholder: '75', maxLength: 3 }));
      if (action === 'seek') return i.showModal(modalWithText({ customId: 'music:seekmodal', title: 'Seek', label: 'Position in seconds', description: 'Enter the position to seek to.', inputId: 'seconds', placeholder: '90', maxLength: 8 }));
      if (action === 'remove') return i.showModal(modalWithText({ customId: 'music:removemodal', title: 'Remove from Queue', label: 'Queue position', description: 'Enter the queue position to remove.', inputId: 'position', placeholder: '1', maxLength: 3 }));

      if (action === 'pause') await music.pause(i);
      else if (action === 'resume') await music.resume(i);
      else if (action === 'skip') await music.skip(i);
      else if (action === 'previous') await music.previous(i);
      else if (action === 'stop') await music.stop(i);
      else if (action === 'leave') await music.leave(i);
      else if (action === 'shuffle') await music.shuffle(i);
      else if (action === 'clearqueue') await music.clearQueue(i);
      else if (action === 'loop') {
        const s = music.snapshot(i.guildId);
        const next = s?.repeatMode === 'off' ? 'track' : s.repeatMode === 'track' ? 'queue' : 'off';
        await music.setLoop(i, next);
      } else if (action === 'queue') {
        const s = music.snapshot(i.guildId);
        const body = s?.queue?.length
          ? s.queue.slice(0, 20).map(x => `${x.position}. ${x.title} — ${music.formatDuration(x.duration)}`).join('\n')
          : 'Queue is empty.';
        return i.update(v2Payload([
          { type: 'text', value: `## 📋 Music Queue\n\n${body}` },
          { type: 'separator', value: separator() },
          { type: 'row', value: row([button('music:back', 'Back', ButtonStyle.Secondary)]) }
        ]));
      } else if (action === 'back') {
        return i.update(panel(i));
      }

      return i.update(panel(i));
    } catch (e) {
      const payload = v2Payload([{ type: 'text', value: text(`## 🎵 Music Error\n\n${e.message}`) }], { ephemeral: true });
      if (i.deferred || i.replied) return i.editReply(payload);
      return i.reply(payload);
    }
  },

  async handleModal(i) {
    if (!i.customId.startsWith('music:')) return false;
    try {
      if (i.customId === 'music:playmodal') {
        await i.deferReply({ flags: 64 });
        const r = await music.play(i, i.fields.getTextInputValue('query'));
        const playlistName = r.playlist?.name;
        const message = playlistName
          ? `## 🎵 Playlist Added\n\n**${playlistName}**\n${r.added} track${r.added === 1 ? '' : 's'} added to the queue.`
          : `## 🎵 Added to Queue\n\n**${r.track?.info?.title || r.track?.title || 'Track'}**`;
        return i.editReply(v2Payload([{ type: 'text', value: text(message) }], { ephemeral: true }));
      }
      if (i.customId === 'music:volumemodal') {
        const n = Number(i.fields.getTextInputValue('level'));
        if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('Volume must be between 0 and 100.');
        await music.setVolume(i, n);
        return i.reply(v2Payload([{ type: 'text', value: text(`🔊 Volume set to **${n}%**.`) }], { ephemeral: true }));
      }
      if (i.customId === 'music:seekmodal') {
        const seconds = Number(i.fields.getTextInputValue('seconds'));
        if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Position must be a valid number of seconds.');
        await music.seek(i, Math.floor(seconds * 1000));
        return i.reply(v2Payload([{ type: 'text', value: text(`⏩ Seeked to **${Math.floor(seconds)} seconds**.`) }], { ephemeral: true }));
      }
      if (i.customId === 'music:removemodal') {
        const pos = Number(i.fields.getTextInputValue('position'));
        if (!Number.isInteger(pos) || pos < 1) throw new Error('Queue position must be a positive whole number.');
        await music.removeAt(i, pos);
        return i.reply(v2Payload([{ type: 'text', value: text(`🗑️ Removed queue position **${pos}**.`) }], { ephemeral: true }));
      }
    } catch (e) {
      const payload = v2Payload([{ type: 'text', value: text(`## 🎵 Music Error\n\n${e.message}`) }], { ephemeral: true });
      if (i.deferred || i.replied) return i.editReply(payload);
      return i.reply(payload);
    }
    return false;
  }
};
