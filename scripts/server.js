/* eslint no-console: "off" */

const http = require('http');
const portscanner = require('portscanner');
const nodeStatic = require('node-static');
const files = new nodeStatic.Server(process.cwd(), {cache: false});
const addSignalServer = require('../src/add-signal-server.js');
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-cache,must-revalidate');

  request.addListener('end', () => {
    files.serve(request, response, (err) => {
      if (err) {
        response.writeHead(err.status, err.headers);
        response.end('Not Found');
      }

      console.log([
        (new Date()).toISOString(),
        `[${response.statusCode}]`,
        request.url
      ].join(' '));
    });
  }).resume();
});

addSignalServer(server);

portscanner.findAPortNotInUse(9999, 10999).then((port) => {
  server.listen(port, '0.0.0.0', function() {
    const host = server.address();

    console.log('Serving "." at http://' + host.address + ':' + host.port);
  });

}).catch((err) => {
  console.log('could not find an open port: ', err);
  process.exit(1);
});
