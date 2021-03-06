"use strict";

const os = require('os');
const util = require('util');

const Discordie = require('discordie');

class Bot {
  constructor(container) {
    this.container = container;
    this.commandManager = container.get('commandManager');
    this.db = container.get('db');
    this.logger = container.get('logger');

    this.client = new Discordie();
    this.primaryGuild = null;

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.Dispatcher.on(Discordie.Events.GATEWAY_READY, this.onGatewayReady.bind(this));
    this.client.Dispatcher.on(Discordie.Events.VOICE_DISCONNECTED, this.onVoiceDisconnected.bind(this));
    this.client.Dispatcher.on(Discordie.Events.GUILD_UNAVAILABLE, this.onGuildUnavailable.bind(this));
    this.client.Dispatcher.on(Discordie.Events.DISCONNECTED, this.onDisconnect.bind(this));
    this.client.Dispatcher.on(Discordie.Events.MESSAGE_CREATE, this.onMessageCreate.bind(this));
    this.client.Dispatcher.on(Discordie.Events.GUILD_CREATE, this.onGuildCreate.bind(this));
  }

  start() {
    const oauth = this.container.get('secrets').get('oauth');

    if (this.container.get('environment') === 'production') {
      this.client.connect({
        token: oauth.response.token
      });
    }
  }

  stop() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  reconnect(channel, retryCount=1) {
    const channelName = channel.name;

    // this example will stop reconnecting after 1 attempt
    // you can continue trying to reconnect

    if (retryCount > 5) {
      this.logger.error(`Failed to reconnect to ${channelName} after ${retryCount - 1} times`);
    }

    // TODO: implement this.onConnected
    //  .then(info => this.onConnected(info))
    channel.join()
      .then(info => this.onVoiceConnected(info))
      .catch(err => {
        this.logger.warn(`Failed to connect to ${channelName}`, err);
        setTimeout(() => {
          this.reconnect(channel, retryCount + 1);
        }, 1000 * retryCount);
      });
  }

  checkGuild(guild) {
    this.db.addGuild(guild);

    this.container.get('events').emit('ADD_GUILD', guild);

    if (guild.id === this.container.get('ids').mainGuild) {
      this.primaryGuild = guild;

      if (this.primaryGuild) {
        this.logger.info('Found primary guild!');
      }
    }
  }

  onGatewayReady(e) {
    this.logger.info(`Connected as: ${this.client.User.username}`);

    this.client.Guilds.forEach((guild) => this.checkGuild(guild));
  }

  onVoiceDisconnected(e) {
    this.logger.info('Disconnected from voice server', e.error);

    const channel = e.voiceConnection.channel;
    if (!channel) {
      this.logger.info('Cannot reconnect, channel has been deleted');
      return;
    }

    if (e.endpointAwait) {
      // handle reconnect instantly if it's a server-switch disconnect
      // transparently creates same promise as `oldChannel.join()`
      // see the `reconnect` function below

      // Note: During Discord outages it will act like the official client
      //       and wait for an endpoint. Sometimes this can take a very
      //       long time. To cancel pending reconnect just call leave on
      //       the voice channel. Pending promise will reject with
      //       `Error` message "Cancelled".

      e.endpointAwait.catch((err) => {
        // server switching failed, do a regular backoff
        setTimeout(() => this.reconnect(channel), 5000);
      });
      return;
    }

    // normal disconnect
    if (!e.manual) {
      setTimeout(() => this.reconnect(channel), 5000);
    }
  }

  onVoiceConnected(info) {
    this.logger.debug(`Connected to ${info.voiceConnection.channel.name}`);
  }

  onGuildUnavailable(e) {
    this.logger.debug(`Guild ${e.guildId} unavailable`);
  }

  onDisconnect(e) {
    const delay = 5000;
    const sdelay = Math.floor(delay / 100) / 10;

    // This shouldn't happen according to Discordie docs, but just to make sure
    if (this.container.get('shutdownMode')) {
      this.logger.info(`Disconnected from gw, not reconnecting because of shutdown mode`);
      return;
    }

    if (e.error.message.indexOf('gateway') !== -1) {
      this.logger.info(`Disconnected from gw, resuming in ${sdelay} seconds`);
    } else {
      this.logger.warn(`Failed to log in or get gateway, reconnecting in ${sdelay} seconds`);
    }

    setTimeout(this.start.bind(this), delay);
  }

  onCommandError(m, err) {
    this.logger.error(`Error processing command: ${err && err.stack}`);

    m.reply(`Oops. An error occurred handling that command.\n\`\`\`${err.stack}\`\`\``);
  }

  // Handle incoming messages
  // Pass the message off to the `CommandManager` for processing
  onMessageCreate(e) {
    if (!e.message.content) return;

    this.commandManager.handle(e.message).catch((err) => this.onCommandError(e.message, err));
  }

  onGuildCreate(e) {
    this.logger.debug(`Guild ${e.guild.name} (id: ${e.guild.id}) is now available (becameAvailable: ${e.becameAvailable})`);

    this.checkGuild(e.guild);
  }
}

/*
client.Dispatcher.onAny((type, args) => {
  console.log("\nevent "+type);

  if (args.type == "READY" || args.type == "READY" ||
      type == "GATEWAY_READY" || type == "ANY_GATEWAY_READY" ||
      type == "GATEWAY_DISPATCH") {
    return console.log("e " + (args.type || type));
  }

  console.log("args " + JSON.stringify(args));
});
*/

module.exports = function createBot(container) {
  return new Bot(container);
};
