/* eslint-disable no-console */
import videojs from 'video.js';
import {version as VERSION} from '../package.json';
import window from 'global/window';
import iceServers from './ice-servers';

const safeParseJson = function(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error('bad json', e);
    return '';
  }
};

// Default options for the plugin.
const defaults = {
  enabled: true,
  iceServers,
  // tod
  signalServer: 'ws://' + window.location.host
};
const Plugin = videojs.getPlugin('plugin');

class GroupPlay extends Plugin {
  constructor(player, options) {
    super(player, options);

    this.options_ = videojs.mergeOptions(defaults, options);

    // set a new room hash or get the room hash
    /*
    if (this.options_.hash) {
      window.location.hash = this.options_.hash;
    } else if (!window.location.hash) {
      window.location.hash = Math.floor(Math.random() * 0xFFFFFF).toString(16);
    }

    this.hash_ = window.location.hash.substring(1);*/

    this.rtcPlayHandler_ = () => {
      this.rtcSend({type: 'player-control-play'});
    };

    this.rtcPauseHandler_ = () => {
      this.rtcSend({type: 'player-control-pause'});
    };

    this.rtcSeekedHandler_ = () => {
      this.rtcSend({type: 'player-control-seek', data: {currentTime: this.player.currentTime()}});
    };

    this.rtcSetup();
    this.signalSetup();
  }

  rtcSetup() {
    this.rtc_ = new window.RTCPeerConnection({iceServers});


    this.rtc_.onicecandidate = (e) => {
      if (!e || !e.candidate) {
        console.log('end of candidates');
        return;
      }

      this.signalSend({
        type: 'candidate',
        data: {candidate: e.candidate, url: window.location.href, id: this.id_}
      });
    };

    this.rtc_.ondatachannel = (e) => this.rtcChannelSetup_(e.channel);
  }

  rtcChannelSetup_(channel) {
    // remove old listeners
    if (this.rtcChannel_) {
      this.rtcChannel_.close();
    }

    this.rtcChannel_ = channel;

    this.rtcChannel_.onopen = () => {
      if (this.rtcChannel_.readyState !== 'open') {
        return;
      }

      this.player.on('play', this.rtcPlayHandler_);
      this.player.on('pause', this.rtcPauseHandler_);
      this.player.on('seeked', this.rtcSeekedHandler_);

      // TODO: sync intially between all players
      // 1. Go to the earliest currentTime of all players
      // 2. Start/Pause as needed
    };

    this.rtcChannel_.onclose = () => {
      console.log(`receive channel state is now ${this.rtcChannel_.readyState}`);

      this.player.off('play', this.rtcPlayHandler_);
      this.player.off('pause', this.rtcPauseHandler_);
      this.player.off('seeked', this.rtcSeekedHandler_);
    };

    this.rtcChannel_.onmessage = (message) => this.rtcRecv(message);
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
      this.id_ = serverMessage.data.id;
    } else if (serverMessage.type === 'need-offer') {
      this.rtc_.createOffer().then((description) => {
        this.rtc_.setLocalDescription(description);
        this.signalSend({
          type: 'offer',
          data: {offer: description, url: window.location.href, from: this.id_, to: serverMessage.data.to}
        });
      }).catch((error) => console.error(error));
    } else if (serverMessage.type === 'offer') {
      this.rtc_.setRemoteDescription(serverMessage.data.offer);

      this.rtc_.createAnswer().then((description) => {
        this.rtc_.setLocalDescription(description);
        // we send to the "from" here because that is where the offer came from
        this.signalSend({
          type: 'answer',
          data: {answer: description, url: window.location.href, from: this.id_, to: serverMessage.data.from}
        });
      }).catch((error) => console.error(error));

    } else if (serverMessage.type === 'answer') {
      this.rtc_.setRemoteDescription(serverMessage.data.answer);
    } else if (serverMessage.type === 'candidate') {
      this.rtc_.addIceCandidate(serverMessage.data.candidate)
        .then(() => console.log('added ice candidate', serverMessage.data.candidate))
        .catch((error) => console.error('error adding ice candidate', error));
    }
  }

  rtcSend(message) {
    console.log('rtc send ->', message);
    this.rtcChannel_.send(JSON.stringify(message));
  }

  rtcRecv(message) {
    const rtcMessage = safeParseJson(message.data);

    console.log('rtc recv <-', rtcMessage);

    // only play when we get a remote play message, and we are paused
    if (rtcMessage.type === 'player-control-play') {
      // skip the next play event, since it is not caused by this player
      this.player.off('play', this.rtcPlayHandler_);
      this.player.one('play', () => this.player.on('play', this.rtcPlayHandler_));

      this.player.play();

    // only pause when we get a remote pause message, and we are playing
    } else if (rtcMessage.type === 'player-control-pause') {

      // skip the next play event, since it is not caused by this player
      this.player.off('pause', this.rtcPauseHandler_);
      this.player.one('pause', () => this.player.on('pause', this.rtcPauseHandler_));

      this.player.pause();
    } else if (rtcMessage.type === 'player-control-seek') {

      // skip the next play event, since it is not caused by this player
      this.player.off('seeked', this.rtcSeekedHandler_);
      this.player.one('seeked', () => this.player.on('seeked', this.rtcSeekedHandler_));

      this.player.currentTime(rtcMessage.data.currentTime);
    }
  }

  signalSetup() {
    this.signalConnection_ = new window.WebSocket(this.options_.signalServer);

    this.signalConnection_.onopen = () => {
      this.signalSend({type: 'start', data: {url: window.location.href}});
    };

    this.signalConnection_.onmessage = (message) => this.signalRecv(message);
  }

  dispose() {
    this.player = this.oldPlayerTrigger_;
  }
}

// Register the plugin with video.js.
videojs.registerPlugin('groupPlay', GroupPlay);

// Include the version number.
GroupPlay.VERSION = VERSION;

export default GroupPlay;
