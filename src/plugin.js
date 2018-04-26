/* eslint-disable no-console */
import videojs from 'video.js';
import {version as VERSION} from '../package.json';
import window from 'global/window';
import document from 'global/document';
import iceServers from './ice-servers';
import './group-play-button';

// TODO:
// - disable player controls until all players are ready
// - stream from one host to all others so that everyone is at the same point in time
// - implement chat
// - fix the button css
const safeParseJson = function(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error('bad json', e);
    return '';
  }
};

const MODES = [
  // Adds a button that must be clicked to start group play. Clicking
  // will add a hash to the url and then that link can be shared.
  // If there is already a hash in the url that will be used and everything
  // will be automatically setup.
  'button',

  // sets up the current player on the page with a hash right away.
  'hash',

  // setups up the current player on the page, but does not use a hash
  // this means that by default the player will be group shared
  'no-hash',

  // The user will call groupPlay.setup on their own
  'manual'
];

// Default options for the plugin.
const defaults = {
  mode: 'hash',
  // TODO
  // chat: true,
  iceServers,
  signalServer: 'ws://' + window.location.host
};
const Plugin = videojs.getPlugin('plugin');

class GroupPlay extends Plugin {
  constructor(player, options = {}) {
    super(player, options);

    player.addClass('vjs-group-play');
    this.options_ = videojs.mergeOptions(defaults, options);

    this.peerRecv = this.peerRecv.bind(this);
    if (MODES.indexOf(this.options_.mode) === -1) {
      console.error(`${this.options_.mode} is not a valid mode, please use: ${MODES.join(', ')}`);
      console.log('falling back to default mode ' + defaults.mode);
      this.options_.mode = defaults.mode;
    }

    if (this.options_.mode === 'button') {
      this.button = this.player.controlBar.addChild('GroupPlayButton', {});

      if (window.location.hash) {
        player.setTimeout(() => this.setup(), 0);
      }
    } else if (this.options_.mode !== 'manual') {
      player.setTimeout(() => this.setup(), 0);
    }
  }

  setup() {
    // set a new room hash or get the room hash
    if (this.options_.mode !== 'no-hash' && !window.location.hash) {
      window.location.hash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
    }

    this.peers = [];
    this.rtcPlayHandler_ = () => this.peerSend({type: 'play'});
    this.rtcPauseHandler_ = () => this.peerSend({type: 'pause'});
    this.rtcSeekingHandler_ = () => this.peerSend({type: 'seeking', data: {currentTime: this.player.currentTime()}});

    this.player.on('play', this.rtcPlayHandler_);
    this.player.on('pause', this.rtcPauseHandler_);
    this.player.on('seeking', this.rtcSeekingHandler_);

    // TODO: sync intially between all players
    // 1. Go to the earliest currentTime of all players
    // 2. Start/Pause as needed

    this.signalConnection_ = new window.WebSocket(this.options_.signalServer);
    this.signalConnection_.onmessage = (message) => this.signalRecv(message);

    this.signalConnection_.onopen = () => {
      this.signalSend({type: 'start', data: {url: window.location.href}});
    };

    this.player.addClass('vjs-group-play-sharing');
    this.isSetup_ = true;
    this.player.trigger('group-play-change');
  }

  addPeer_(id, createDataChannel = false) {
    const peer = new window.RTCPeerConnection({iceServers});

    peer.id = id;
    peer.ondatachannel = (e) => {
      if (peer.channel) {
        peer.channel.close();
      }

      peer.channel = e.channel;
      peer.channel.onmessage = this.peerRecv;
    };

    peer.onicecandidate = (e) => {
      this.signalSend({
        type: 'candidate',
        data: {candidate: e.candidate, id: peer.id}
      });
    };

    if (createDataChannel) {
      peer.ondatachannel({channel: peer.createDataChannel('videojs-group-play')});
    }

    this.peers.push(peer);
    console.log('added peer', peer.id);

    return peer;
  }

  getPeer(id) {
    return this.peers.filter((p) => p.id === id)[0];
  }

  removePeer_(id) {
    const peer = this.getPeer(id);

    if (!peer) {
      return;
    }

    const i = this.peers.indexOf(peer);

    this.peers.splice(i, 1);

    peer.onicecandidate = null;
    peer.ondatachannel = null;

    if (peer.onmessage) {
      peer.channel.onmessage = null;
      peer.channel.close();
    }
    console.log('removed peer', peer.id);
  }

  signalSend(message) {
    console.log('signal send ->', message);

    this.signalConnection_.send(JSON.stringify(message));
  }

  signalRecv(message) {
    const serverMessage = safeParseJson(message.data);

    if (!serverMessage) {
      return;
    }

    console.log('signal recv <-', serverMessage);

    if (serverMessage.type === 'start-ack') {
      this.id = serverMessage.data.id;
    } else if (serverMessage.type === 'add-peer') {
      const peer = this.addPeer_(serverMessage.data.id, true);

      peer.createOffer().then((description) => {
        peer.setLocalDescription(description);
        this.signalSend({
          type: 'offer',
          data: {offer: description, id: serverMessage.data.id}
        });
      }).catch((error) => console.error(error));
    } else if (serverMessage.type === 'offer') {
      const peer = this.addPeer_(serverMessage.data.id);

      peer.setRemoteDescription(serverMessage.data.offer);

      peer.createAnswer().then((description) => {
        peer.setLocalDescription(description);

        // we send to the "from" here because that is where the offer came from
        this.signalSend({
          type: 'answer',
          data: {answer: description, id: serverMessage.data.id}
        });
      }).catch((error) => console.error(error));
    } else if (serverMessage.type === 'answer') {
      const peer = this.getPeer(serverMessage.data.id);

      peer.setRemoteDescription(serverMessage.data.answer);
    } else if (serverMessage.type === 'candidate') {
      const peer = this.getPeer(serverMessage.data.id);

      if (!serverMessage.data.candidate) {
        this.peerSend({type: 'get-player-state', data: {id: this.id}});
        return;
      }

      peer.addIceCandidate(serverMessage.data.candidate)
        .then(() => console.log('added ice candidate', serverMessage.data.candidate))
        .catch((error) => console.error('error adding ice candidate', error));
    } else if (serverMessage.type === 'remove-peer') {
      this.removePeer_(serverMessage.data.id);
    }
  }

  peerSend(message) {
    if (!this.peers.length) {
      return;
    }
    console.log('rtc send ->', message);
    message = JSON.stringify(message);

    this.peers.forEach((p) => {
      const send = () => {
        p.channel.send(message);
      };
      const onopen = () => {
        p.channel.removeEventListener('open', onopen);
        send();
      };
      const ondatachannel = () => {
        p.channel.addEventListener('open', onopen);
        p.removeEventListener('datachannel', ondatachannel);
      };

      // if there is no data channel on this peer yet
      // wait for it to open then send the event
      if (!p.channel) {
        p.addEventListener('datachannel', ondatachannel);
        return;
      }

      // if the data channel is not open yet
      // wait for that and then send
      if (p.channel.readyState !== 'open') {
        p.channel.addEventListener('open', onopen);
        return;
      }

      // otherwise just send
      send();
    });
  }

  handlePeerMessage_(message) {
    // only play when we get a remote play message, and we are paused
    if (message.type === 'play') {
      // skip the next play event, since it is not caused by this player
      this.player.off('play', this.rtcPlayHandler_);
      this.player.one('play', () => this.player.on('play', this.rtcPlayHandler_));

      this.player.play();

      // only pause when we get a remote pause message, and we are playing
    } else if (message.type === 'pause') {

      // skip the next play event, since it is not caused by this player
      this.player.off('pause', this.rtcPauseHandler_);
      this.player.one('pause', () => this.player.on('pause', this.rtcPauseHandler_));

      this.player.pause();
    } else if (message.type === 'seeking') {

      // skip the next play event, since it is not caused by this player
      this.player.off('seeking', this.rtcSeekingHandler_);
      this.player.one('seeking', () => this.player.on('seeking', this.rtcSeekingHandler_));

      this.player.currentTime(message.data.currentTime);
    } else if (message.type === 'get-player-state') {
      const peer = this.getPeer(message.data.id);

      console.log('sending player-state');
      peer.channel.send(JSON.stringify({
        type: 'player-state',
        data: {
          currentTime: this.player.currentTime(),
          paused: this.player.paused(),
          hasStarted: this.player.hasStarted()
        }
      }));
    } else if (message.type === 'player-state') {

      if (message.data.currentTime > this.player.currentTime()) {
        // act like we got a seeking message
        this.handlePeerMessage_({type: 'seeking', data: {currentTime: message.data.currentTime}});
      }

      // if any remote peer has started, we need to set
      // has started here to remove the big play button
      if (message.data.hasStarted) {
        this.player.hasStarted(true);
      }

      // act like we got a play/pause
      if (this.player.paused() !== message.data.paused) {
        if (message.data.paused === true) {
          this.handlePeerMessage_({type: 'pause'});
        } else {
          this.handlePeerMessage_({type: 'pause'});

        }
      }
    }

  }

  peerRecv(message) {
    const rtcMessage = safeParseJson(message.data);

    console.log('rtc recv <-', rtcMessage);
    this.handlePeerMessage_(rtcMessage);
  }

  reset() {
    this.player.off('play', this.rtcPlayHandler_);
    this.player.off('pause', this.rtcPauseHandler_);
    this.player.off('seeking', this.rtcSeekingHandler_);

    if (window.location.hash) {
      // remove the hash including the leading hashtag
      window.history.pushState('', document.title, window.location.pathname + window.location.search);
    }

    let i = this.peers.length;

    while (i--) {
      this.removePeer_(this.peers[i]);
    }
    this.peers = [];

    this.signalConnection_.close();

    this.player.removeClass('vjs-group-play-sharing');
    this.isSetup_ = false;
    this.trigger('group-play-change');
  }
}

// Register the plugin with video.js.
videojs.registerPlugin('groupPlay', GroupPlay);

// Include the version number.
GroupPlay.VERSION = VERSION;

export default GroupPlay;
