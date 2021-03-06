"use strict";

const path = require('path');
const url = require('url');

const https = require('follow-redirects').https;

const Types = require('./types');

const YOUTUBE_DL_STORAGE_DIRECTORY = process.env.YOUTUBE_DL_STORAGE_DIRECTORY || '/music';

let logger = null;

class QueuedMedia {
  constructor(musicPlayer, record) {
    Object.defineProperty(this, 'musicPlayer', {
      enumerable: false,
      value: musicPlayer,
    });

    this.corked = false;

    this.type = record.type;
    this.ownerId = record.ownerId;
    this.guildId = record.guildId;

    this.id = record.id || '';
    this.title = record.title || '';
    this.url = record.url || '';
    this.path = record.path || '';
    this.encoding = record.encoding || '';
    this.duration = record.duration || 0;
    this.stream = null;
    this.time = null;

    if (this.type !== Types.YTDL && this.type !== Types.LOCAL) {
      throw new Error(`unknown type: ${this.type}`);
    }

    this.play = this.play.bind(this);
    this.stopPlaying = this.stopPlaying.bind(this);
    this.printString = this.printString.bind(this);
  }

  static initialize(container) {
    logger = container.get('logger');
  }

  hookEncoderEvents() {
    this.encoder.once('end', () => {
      logger.debug('encoder end', this.id || this.url, this.encoding);
      this.donePlaying();
    });
    this.encoder.once('unpipe', () => {
      logger.debug('encoder unpipe', this.id || this.url, this.encoding);
    });
    this.encoder.once('error', (err) => {
      logger.debug('encoder error', this.id || this.url, this.encoding, err);
    });
  }

  hookPlayEvents() {
    this.stream = this.encoder.play();

    this.stream.resetTimestamp();
    this.stream.removeAllListeners('timestamp');
    this.stream.on('timestamp', (time) => {
      // logger.debug('stream timestamp', this.id || this.url, this.encoding, time);
      this.time = time;
    });
    this.stream.once('end', () => {
      logger.debug('stream end', this.id || this.url, this.encoding);
    });
    this.stream.once('unpipe', () => {
      logger.debug('stream unpipe', this.id || this.url, this.encoding);
    });
  }

  play(voiceConnection) {
    if (this.type === Types.YTDL) {
      return this.playHTTPS(voiceConnection);
    } else if (this.type === Types.LOCAL) {
      return this.playLocal(voiceConnection);
    }
  }

  playHTTPS(voiceConnection, retry) {
    logger.debug(`playHTTPS: ${this.id} ${this.encoding}`);
    //logger.debug('audio is not opus, using ffmpeg');

    this.encoder = voiceConnection.createExternalEncoder({
      type: 'ffmpeg',
      source: this.path,
      format: 'opus',
      outputArgs: ['-ab', '64k'],
      debug: true,
      destroyOnUnpipe: false,
    });

    this.hookEncoderEvents();
    this.hookPlayEvents();
  }

  playLocal(voiceConnection) {
    logger.debug(`playLocal: ${this.url} ${this.encoding}`);

    this.encoder = voiceConnection.createExternalEncoder({
      type: 'ffmpeg',
      source: this.path,
      format: 'opus',
      debug: true,
    });

    this.hookEncoderEvents();
    this.hookPlayEvents();
  }

  playOpusHTTPS(voiceConnection, retry) {
    logger.debug(`playOpusHTTPS: ${this.id} ${this.encoding}`);

    const parsed = url.parse(this.url);
    //parsed.rejectUnauthorized = false;

    const req = https.get(parsed);

    req.once('response', (res) => {
      logger.debug(`have response: ${res.statusCode}`);

      if (res.statusCode === 302 && this.type === Types.YTDL && (this.formatIndex + 1) !== this.formats.length) {
        logger.debug(`damn youtube 302`);

        this.formatIndex++;

        const format = this.formats[this.formatIndex];
        this.encoding = format.audioEncoding;
        this.url = format.url;

        this.play(voiceConnection);
        return;
      } else if (res.statusCode === 302 && !retry) {
        logger.debug(`redirect playing ${this.id}: status code ${res.statusCode}`);
        setTimeout(() => this.playOpusHTTPS(voiceConnection, true), 1000);
        return;
      } else if (res.statusCode !== 200) {
        logger.debug(`error playing ${this.id}: status code ${res.statusCode}`);
        this.donePlaying();
        return;
      }

      this.encoder = voiceConnection.createExternalEncoder({
        type: 'WebmOpusPlayer',
        source: res,
        debug: true,
      });

      this.hookEncoderEvents();
      this.hookPlayEvents();
      this.stream.once('unpipe', () => res.destroy());
    });

    req.on('error', (err) => {
      logger.debug('request error', this.id, err);
      this.donePlaying();
    });
  }

  pause() {
    logger.debug('pause', this.id || this.url, this.encoding);

    if (this.stream) {
      if (this.corked) {
        this.corked = false;
        this.stream.uncork();
      } else {
        this.corked = true;
        this.stream.cork();
      }
    }
  }

  stopPlaying() {
    logger.debug('stopPlaying', this.id || this.url, this.encoding);

    if (this.stream) {
      this.stream.unpipeAll();
      this.stream = null;
    }

    if (this.encoder) {
      this.encoder.stop();
      this.encoder.destroy();
      this.encoder = null;
    }
  }

  donePlaying() {
    logger.debug('donePlaying', this.id || this.url, this.encoding);
    this.stopPlaying();
    this.musicPlayer.queuedDonePlaying(this);
  }

  printString() {
    return this.musicPlayer.utils.formatInfo(this);
  }
};

module.exports = QueuedMedia;
