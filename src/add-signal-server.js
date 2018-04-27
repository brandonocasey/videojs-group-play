/* eslint-disable no-console */
const WebSocket = require('ws');
const uuid = require('uuid');

// a list of all sockets segmented by the
// url that they are using.
const urlSockets = {};

// a list of all sockets
const sockets = [];

const handleMessage = function(ws, message) {
  let clientMessage = '';

  try {
    clientMessage = JSON.parse(message);
  } catch (e) {
    console.error('bad message', e);
    return;
  }

  console.log('recv from ' + ws.id + ' <- ' + clientMessage.type);

  if (clientMessage.type === 'start') {
    ws.url = clientMessage.data.url;
    ws.send({
      type: 'start-ack',
      data: {id: ws.id}
    });

    urlSockets[ws.url] = urlSockets[ws.url] || [];
    urlSockets[ws.url].push(ws);

    console.log('Added peer ' + ws.id + ' for url ' + ws.url);

    // if there is more then one peer, then we need to tell
    // clients to connect to one another
    if (urlSockets[ws.url].length > 1) {
      // ex [1, 2, 3, 4] this will be at index 3 to start
      let i = urlSockets[ws.url].length - 1;

      while (i--) {
        const peer = urlSockets[ws.url][i];

        peer.send({type: 'add-peer', data: {id: ws.id}});
      }
    }
    return;
  }

  const peers = urlSockets[ws.url];
  const peerWs = peers.filter((p) => p.id === clientMessage.data.id)[0];

  // send the offer to the peer with the specifed id
  if (clientMessage.type === 'offer') {
    peerWs.send({
      type: 'offer',
      data: {offer: clientMessage.data.offer, id: ws.id}
    });

  // send the answer to the peer with the specified id
  } else if (clientMessage.type === 'answer') {
    peerWs.send({
      type: 'answer',
      data: {answer: clientMessage.data.answer, id: ws.id}
    });

  // send the candidates to the peer with the specifed id
  } else if (clientMessage.type === 'candidate') {
    peerWs.send({
      type: 'candidate',
      data: {candidate: clientMessage.data.candidate, id: ws.id}
    });
  }
};

const addSignalServer = function(server) {
  const wss = new WebSocket.Server({server});

  wss.on('listening', function() {
    const host = server.address();

    console.log('Listening for WebSockets on ws://' + host.address + ':' + host.port);
  });

  wss.on('connection', function connection(ws, req) {
    ws.id = uuid.v4();
    ws.url = req.headers.origin;
    const oldSend = ws.send;

    ws.send = function(message) {
      console.log('send to   ' + ws.id + ' -> ' + message.type);
      message = JSON.stringify(message);

      return oldSend.call(ws, message);
    };

    sockets.push(ws);

    ws.on('message', function(message) {
      handleMessage(ws, message);
    });

    ws.on('close', function(message) {
      console.log('Removed peer ' + ws.id + ' for url ' + ws.url);

      sockets.splice(sockets.indexOf(ws), 1);
      // if the client has sent a start already start
      if (ws.url) {
        urlSockets[ws.url].splice(urlSockets[ws.url].indexOf(ws), 1);
        // remove the peer from client lists
        urlSockets[ws.url].forEach(function(w) {
          w.send({
            type: 'remove-peer',
            data: {id: ws.id}
          });
        });
      }
    });
  });
};

module.exports = addSignalServer;
