var net = require('net');
var ws = require('ws');
var fs = require('fs');
var events = require('events');
var tls = require('tls');

function create(portData, newClientCallback) {
  if(!portData.websocket) {
    return createTcpServer(portData, newClientCallback);
  } else {
    return createWebSocketServer(portData, newClientCallback);
  }
}

function createTcpServer(portData, newClientCallback) {
  var server = net.createServer(newClientCallback);

  return {
    listen: function(listenCallback) {
      server.listen(portData.port, listenCallback);
    }
  };
}

function createWebSocketServer(portData, newClientCallback) {
  return {
    listen: function(listenCallback) {
      var app = createHttpServer(portData);
      app.listen(portData.port, '0.0.0.0', listenCallback);

      wss = new ws.Server({server: app, clientTracking: false, perMessageDeflate: false});
      wss.on('connection', function(ws) {
        newClientCallback(simulateTcpSocketFromWS(ws));
      });
    }
  };
}

function buildHttpsContexts(domains) {
  let contexts = {};
  domains.forEach(function(domain) {
    contexts[domain.domain] = tls.createSecureContext({
      key:  fs.readFileSync( domain.key ),
      cert: fs.readFileSync( domain.certificate )
    });
  });
  return contexts;
};

function createHttpsServer(domains, processRequest) {
  const firstDomain = domains[0];
  const contexts = buildHttpsContexts(domains);

  return require('https').createServer({
    key:  fs.readFileSync( firstDomain.key ),
    cert: fs.readFileSync( firstDomain.certificate ),
    SNICallback: function (domain, cb) {
      cb(null, contexts[domain] || contexts[firstDomain.domain]);
    }
  }, processRequest);
}

function createHttpServer(portData) {
  var app = null;
  var processRequest = function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Not implemented');
  };
  if (portData.ssl) {
    app = createHttpsServer(portData.ssl, processRequest);
  } else {
    app = require('http').createServer(processRequest);
  }
  app.allowHalfOpen = false;

  return app;
}

function simulateTcpSocketFromWS(ws) {
  var socket = {};

  socket.remoteAddress = ws._socket.remoteAddress;

  socket.localPort = ws._socket.localPort;

  socket.setKeepAlive = ws._socket.setKeepAlive;

  socket.writable = true;

  socket.setEncoding = function() {};

  socket.destroy = function() {
    ws.removeAllListeners('close');
    ws.close();
  };

  socket.write = function(data) {
    ws.send(data, function(error) {
      if (error) {
        console.log("write", JSON.stringify(error));
        console.log(error);
        socket.emit('error', error);
      }
    });
  };

  ws.on('message', function(data) {
    socket.emit('data', data);
  });

  ws.on('close', function() {
    socket.emit('close');
  });

  ws.on('error', function(e) {
    console.log("error", JSON.stringify(e));
    console.log(e);
    socket.emit('error', e);
  });

  socket.__proto__ = events.EventEmitter.prototype;

  return socket;
};

module.exports = {create: create};
