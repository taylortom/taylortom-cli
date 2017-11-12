var open = require("open");

var config = require("../js/config");
var logger = require("../js/logger");

/*
* @name launch
* @description Opens site in browser
*/
module.exports = function launch(args) {
  logger.task("Navigating to " + logger.var(config.server.url));
  open(config.server.url);
};
