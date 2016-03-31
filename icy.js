"use strict";

const stream = require('stream');
const util = require('util');

const debug = require('debug')('hubot-icy');
const icy = require('icy');
const lame = require('lame');
//const Speaker = require('speaker');

const Actions = require('./actions');
const Dispatcher = require('./dispatcher');
const Settings = require('./settings');

const Discord = require('./bot');

const URL = 'http://172.16.21.4:8000';

var textChannel = null;
var lastStreamTitle = null;

Dispatcher.on(Actions.DISCORD_FOUND_TEXT_CHANNEL, (newTextChannel) => {
  textChannel = newTextChannel;
});

Dispatcher.on(Actions.DISCORD_JOINED_VOICE_CHANNEL, () => {
  icy.get(URL, (res) => {
    debug('received icy response', res.headers);

    res.on('metadata', (meta) => {
      const parsed = icy.parse(meta);
      debug('parsed metadata', parsed);

      if (parsed && parsed.StreamTitle !== lastStreamTitle) {
        lastStreamTitle = parsed.StreamTitle;

        setTimeout(() => {
          Discord.bot.sendMessage(textChannel, parsed.StreamTitle).then(() => console.log(`reported song status to ${Settings.TEXT_CHANNEL}`));
          Discord.bot.setPlayingGame(parsed.StreamTitle).then(() => console.log(`set status to song`));
        }, Math.max(1000, Settings.STATUS_DELAY_TIME) - 1000);
      }

      Dispatcher.emit(Actions.ICY_METADATA, meta);
    });

    //bot.voiceConnection.playRawStream(res.pipe(new lame.Decoder()));
    //Discord.bot.voiceConnection.playRawStream(res, { volume: 0.3 });

    Dispatcher.emit(Actions.ICY_CONNECTED, res);
  });
});

function discordPlayStream(output) {
  return new Promise((resolve, reject) => {
    var intent = Discord.bot.voiceConnection.playStream(output, 2);

    //intent.on('time', (time) => debug('intent time', time));

    intent.on('end', () => {
      debug('stream end reported');
      //res.end();
      //output.end();

      //Dispatcher.emit(Actions.DISCORD_JOINED_VOICE_CHANNEL);
      resolve(true);
    });

    //output.pipe(new Speaker({
    //  channels: 2,
    //  sampleRate: 48000,
    //  bitDepth: 16
    //}));
  });
}

Dispatcher.on(Actions.ICY_CONNECTED, (res) => {
  const stream = new ReduceVolumeStream();
  const output = res.pipe(new lame.Decoder()).pipe(stream);
  //const output = res;

  function volumeListener(volume) {
    debug('setting stream volume to ' + volume);
    stream.setVolume(volume / 100);
  };
  Dispatcher.on(Actions.SET_AUDIO_VOLUME, volumeListener);

  output.once('readable', () => setTimeout(() => {
    function onEnd() {
      discordPlayStream(output).then(() => {
        setTimeout(onEnd, Settings.STATUS_DELAY_TIME);
      });
    };
    onEnd();
  }, Settings.STATUS_DELAY_TIME));

  output.once('error', (err) => {
    console.error(err);
    Discord.bot.voiceConnection.stopPlaying();
  });
});

function ReduceVolumeStream() {
  stream.Transform.call(this);

  this.setVolume(Settings.STREAM_VOLUME);
};
util.inherits(ReduceVolumeStream, stream.Transform);

ReduceVolumeStream.prototype.setVolume = function setVolume(volume) {
  this.volume = volume;
};

ReduceVolumeStream.prototype._transform = function _transform(chunk, encoding, cb) {
  const out = new Buffer(chunk.length);

  for (var i = 0; i < chunk.length; i += 2) {
    var uint = Math.floor(this.volume * chunk.readInt16LE(i));

    uint = Math.min(32767, uint);
    uint = Math.max(-32767, uint);

    out.writeInt16LE(uint, i);
  }

  this.push(out);

  cb();
};
