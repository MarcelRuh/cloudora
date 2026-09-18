"use strict";

const http = require("node:http");
const https = require("node:https");

function patch(Server) {
  const listen = Server.prototype.listen;
  Server.prototype.listen = function listenWithLongDownloads(...args) {
    this.requestTimeout = 0;
    this.headersTimeout = 0;
    this.timeout = 0;
    this.keepAliveTimeout = 120000;
    return listen.apply(this, args);
  };
}

patch(http.Server);
patch(https.Server);
