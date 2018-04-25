const WebSocket = require('ws');
const uuid = require('uuid');
const peers = {
  // url: [peers]
};

const handleMessage = function(ws, message) {
  console.log('received: %s', message);
  let req = '';

  try {
    req = JSON.parse(message);
  } catch (e) {
    console.error('bad message', e);
    return;
  }

  peers[req.data.url] = peers[req.data.url] || [];

  const urlPeers = peers[req.data.url];
  let i = urlPeers.length;

  // remove invalid peers
  while (i--) {
    const p = urlPeers[i];

    // remove invalid peer
    if (p.ws.readyState === 2 || p.ws.readyState === 3) {
      urlPeers.splice(i, 1);
    }
  }

  if (req.type === 'start') {
    const peer = {ws, id: uuid.v4()};

    urlPeers.push(peer);

    ws.send(JSON.stringify({
      type: 'start-ack',
      data: {id: peer.id}
    }));

    if (urlPeers.length === 1) {
      return;
    }

    urlPeers.forEach(function(p) {
      if (p.ws === urlPeers[0].ws) {
        return;
      }

      urlPeers[0].ws.send(JSON.stringify({
        type: 'need-offer',
        data: {to: p.id}
      }));
    });
  } else if (req.type === 'offer') {
    const offerPeer = urlPeers.filter((p) => p.id === req.data.to)[0];

    offerPeer.ws.send(JSON.stringify({
      type: 'offer',
      data: {offer: req.data.offer, to: req.data.to, from: req.data.from}
    }));
  } else if (req.type === 'answer') {
    const answerPeer = urlPeers.filter((p) => p.id === req.data.to)[0];

    answerPeer.ws.send(JSON.stringify({
      type: 'answer',
      data: {answer: req.data.answer, to: req.data.to, from: req.data.from}
    }));
  } else if (req.type === 'candidate') {
    // send candidates to all other peers
    urlPeers.forEach((p) => {
      if (p.ws === ws) {
        return;
      }

      p.ws.send(JSON.stringify({
        type: 'candidate',
        data: {candidate: req.data.candidate}
      }));
    });

  }
};

const addSignalServer = function(server) {
  const wss = new WebSocket.Server({server});

  wss.on('listening', function() {
    const host = server.address();

    console.log('Listening for WebSockets on ws://' + host.address + ':' + host.port);
  });

  wss.on('connection', function connection(ws) {

    ws.on('message', function(message) {
      handleMessage(ws, message);
    });

    ws.on('close', function(message) {
      // TODO
      console.log('some ws closed');
    });

  });
};

module.exports = addSignalServer;
