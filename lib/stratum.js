var server = require('./server.js');
var async = require('async');
var events = require('events');
var CryptoJS = require('crypto-js');

var threadId = '(Thread ' + process.env.forkId + ') ';
var logSystem = 'stratum';
var log = function(severity, system, text, data){
  global.log(severity, system, threadId + text, data);
};

var httpResponse = ' 200 OK\nContent-Type: text/plain\nContent-Length: 20\n\nmining server online';

function start(newSocketCallback, callback) {
  async.each(config.poolServer.ports, function(portData, portCallback){
    startPort(portData, newSocketCallback, portCallback);
  }, function(err){
    if (err)
      callback(false);
    else
      callback(true);
  });
};

function startPort(portData, newSocketCallback, callback) {
  server.create(portData, function(socket) {
    var communicator = new Communicator(socket, selectTransport(portData.encryptionKey));
    newSocketCallback(communicator, portData);
  }).listen(function (error, result) {
    if (error) {
      log('error', logSystem, 'Could not start server listening on port %d, error: $j', [portData.port, error]);
      callback(true);
      return;
    }
    var type = portData.websocket ? 'websocket' : 'tcp';
    log('info', logSystem, 'Started %s server listening on port %d', [type, portData.port]);
    callback();
  });
};

function PlainText() {
  return {
    write: function(text) { return text; },
    read: function(text) { return text; }
  };
}

function AESEncrypted(encryptionKey) {
  return {
    write: function(text) {
      var encrypted = CryptoJS.AES.encrypt(text, encryptionKey).toString();
      return encrypted;
    },
    read: function(text) {
      try {
        var decrypted = CryptoJS.AES.decrypt(text, encryptionKey).toString(CryptoJS.enc.Utf8);
        if(!decrypted) throw 'Decrypted is empty';
        return decrypted;
      } catch (_) {
        return text;
      }
    }
  };
}

function selectTransport(encryptionKey) {
  if(encryptionKey) {
    return new AESEncrypted(encryptionKey);
  } else {
    return PlainText();
  }
}


function Communicator(socket, transport) {
  this._dataBuffer = '';
  this._socket = socket;
  this._transport = transport;
  this.remoteAddress = this._socket.remoteAddress;

  socket.setKeepAlive(true);
  socket.setEncoding('utf8');

  socket.on('error', this._onSocketError.bind(this));
  socket.on('close', this._onSocketClose.bind(this));
  socket.on('data', this._onSocketData.bind(this));
}

Communicator.prototype = events.EventEmitter.prototype;

Communicator.prototype.pushMessage = function(method, params){
  if(!this._socket.writable) return;

  var sendData = JSON.stringify({
    jsonrpc: "2.0",
    method: method,
    params: params
  });
  this._socket.write(this._transport.write(sendData) + "\n");
};

Communicator.prototype.sendReply = function(id, error, result) {
  if(!this._socket.writable) return;
  var sendData = JSON.stringify({
    id: id,
    jsonrpc: "2.0",
    error: error ? {code: -1, message: error} : null,
    result: result
  });
  this._socket.write(this._transport.write(sendData) + "\n");
};

Communicator.prototype.disconnect = function() {
  this._cleanUp();
  this._socket.destroy();
};

Communicator.prototype._onSocketError = function(error) {
  if (error.code !== 'ECONNRESET')
    log('warn', logSystem, 'Socket error from %s %j', [this._socket.remoteAddress, error]);
};

Communicator.prototype._onSocketClose = function(error) {
  this._cleanUp();
  this.emit('disconnect');
};

Communicator.prototype._cleanUp = function() {
  this.pushMessage = function() {};
  this.sendReply = function() {};
};

Communicator.prototype._onSocketData = function(d) {
  this._dataBuffer += d;
  if (Buffer.byteLength(this._dataBuffer, 'utf8') > 10240){ //10KB
    this._dataBuffer = null;
    log('warn', logSystem, 'Socket flooding detected and prevented from %s', [this._socket.remoteAddress]);
    this._socket.destroy();
    return;
  }
  if (this._dataBuffer.indexOf('\n') !== -1){
    var messages = this._dataBuffer.split('\n');
    var incomplete = this._dataBuffer.slice(-1) === '\n' ? '' : messages.pop();
    for (var i = 0; i < messages.length; i++){
      var rawMessage = messages[i];
      if (rawMessage.trim() === '') continue;
      var message = this._transport.read(rawMessage);
      this._processMessage(this._socket, message);
    }
    this._dataBuffer = incomplete;
  }
};

Communicator.prototype._processMessage = function(socket, message) {
  var jsonData;
  try{
    jsonData = JSON.parse(message);
  }
  catch(e){
    this._onMalformedData(socket, message);
    return;
  }

  if (this._isJsonRPCValid(jsonData)) this.emit('message', jsonData);
};

Communicator.prototype._onMalformedData = function(socket, message) {
  if (message.indexOf('GET /') === 0) {
    if (message.indexOf('HTTP/1.1') !== -1) {
      socket.end('HTTP/1.1' + httpResponse);
      return;
    }
    else if (message.indexOf('HTTP/1.0') !== -1) {
      socket.end('HTTP/1.0' + httpResponse);
      return;
    }
  }

  log('warn', logSystem, 'Malformed message from %s: %s', [socket.remoteAddress, message]);
  socket.destroy();
};


Communicator.prototype._isJsonRPCValid = function(jsonData) {
  if (!jsonData.id) {
    log('warn', logSystem, 'Miner RPC request missing RPC id');
    return false;
  }
  else if (!jsonData.method) {
    log('warn', logSystem, 'Miner RPC request missing RPC method');
    return false;
  }
  else if (!jsonData.params) {
    log('warn', logSystem, 'Miner RPC request missing RPC params');
    return false;
  }
  return true;
};

module.exports = {start: start};
