"use strict";

const debug = require('debug')('hubot-discord');
const Discordie = require('discordie');

const Actions = require('./actions');
const Dispatcher = require('./dispatcher');
const Settings = require('./settings');

const client = new Discordie();
const oath = require('./hubot_oath.json');

let guild = null;

// bot.on('debug', (msg) => {
//   debug(msg);
// });
function shutdownCb(err) {
  console.log(err && err.stack);

  try {
    bot.logout();
  } finally {
    return process.exit(1);
  }
}
// bot.on('error', shutdownCb);
Dispatcher.on('ctrlc', shutdownCb);

client.Dispatcher.on(Discordie.Events.GATEWAY_READY, (e) => {
  debug(`Connected as: ${client.User.username}`);
});

client.Dispatcher.on(Discordie.Events.GUILD_CREATE, (e) => {
  guild = client.Guilds.getBy('name', Settings.SERVER_NAME);

  if (guild) {
    debug('Found correct server!');
    Dispatcher.emit(Actions.DISCORD_FOUND_CORRECT_SERVER, guild);
  } else {
    debug('Guild not found!');
    shutdownCb();
  }
});

client.Dispatcher.on(Discordie.Events.DISCONNECTED, (e) => {
  const delay = 5000;
  const sdelay = Math.floor(delay / 100) / 10;

  if (e.error.message.indexOf('gateway') !== -1) {
    debug(`Disconnected from gw, resuming in ${sdelay} seconds`);
  } else {
    debug(`Failed to log in or get gateway, reconnecting in ${sdelay} seconds`);
  }
  setTimeout(connect, delay);
});

const helpText = `
This is *Hubot*. A general purpose robot.

\`\`\`
Commands:
- ping
  Simple ping and pong to see if bot is responding
- \`play
  Start playing music.
- \`stop
  Stop playing music.
- \`volume <0-100>
  Set the volume of Hubot between 0% and 100%.
- \`next
  Play the next song in the playlist.
  If the song is the last song in the playlist, then Hubot will wrap around to the beginning of the playlist.
- \`prev
  Play the previous song in the playlist.
  If the song is the first song in the playlist, then Hubot will wrap around to the end of the playlist.
\`\`\`
`;

client.Dispatcher.on(Discordie.Events.MESSAGE_CREATE, (e) => {
  if (!e.message.content) return;

  const content = e.message.content;
  const c = content.toLowerCase();
  const args = content.split(' ').filter(x => x.length);

  if (c === 'ping') {
    e.message.channel.sendMessage('pong');
  } else if (c === '`play') {
    Dispatcher.emit(Actions.START_MUSIC_PLAYBACK, e);
  } else if (c === '`stop') {
    Dispatcher.emit(Actions.STOP_MUSIC_PLAYBACK, e);
  } else if (c === '`next') {
    Dispatcher.emit(Actions.NEXT_SONG, e);
  } else if (c === '`previous' || c === '`prev') {
    Dispatcher.emit(Actions.PREVIOUS_SONG, e);
  } else if (args[0].toLowerCase() === '`volume' || args[0].toLowerCase() === '`vol') {
    debug(`volume change: ${args}`);
    if (args.length > 1) {
      const num = parseInt(args[1]);
      if (!isNaN(num)) {
        Dispatcher.emit(Actions.SET_AUDIO_VOLUME, num);
      }
    }
  } else if (c === '`help') {
    e.message.channel.sendMessage(helpText);
  }
});

Dispatcher.on(Actions.DISCORD_FOUND_CORRECT_SERVER, () => {
  const textChannel = guild.textChannels.filter(c => c.name === Settings.TEXT_CHANNEL)[0];
  if (!textChannel) {
    Dispatcher.emit('error', new Error('Cannot find text channel'));
    return;
  }
  Dispatcher.emit(Actions.DISCORD_FOUND_TEXT_CHANNEL, textChannel);

  getVoiceChannel();
});

/*
Dispatcher.on(Actions.DISCORD_FOUND_VOICE_CHANNEL, (voiceChannel) => {
  voiceChannel.join(false, false).then((info, err) => {
    debug('joined voice chat');
    Dispatcher.emit(Actions.DISCORD_JOINED_VOICE_CHANNEL, info);
  });
});
*/

function getVoiceChannel() {
  const voiceChannel = guild.voiceChannels.filter(c => c.name === Settings.VOICE_CHANNEL)[0];
  if (!voiceChannel) {
    Dispatcher.emit('error', new Error('Cannot find voice channel'));
    return null;
  }
  Dispatcher.emit(Actions.DISCORD_FOUND_VOICE_CHANNEL, voiceChannel);

  return voiceChannel;
};

client.connect({
  token: oath.response.token
});

module.exports = {
  client,
  getVoiceChannel,
};
