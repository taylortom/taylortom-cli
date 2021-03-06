var _ = require("underscore");
var async = require("async");

var less = require("./less");
var config = require("../js/config");

/*
* @name compile
* @description Generates the static pages in the output folder
*/
module.exports = function compile(args, cbCompiled) {
  async.parallel([
    function(cbDone) { compilePages(args,cbDone); },
    function(cbDone) { less(args,cbDone); }
  ], cbCompiled);
};

function compilePages(args, cbCompiled) {
  async.forEachOf(config.pages, function iterator(page, key, cbDoneLoop) {
    var p = new (getPageModule(key))(key, page, args);
    async.parallel([
      _.bind(p.loadTemplates, p),
      _.bind(p.loadData, p)
    ], function(error) {
      if(error) return cbDoneLoop(error);
      p.write(cbDoneLoop);
    });
  }, cbCompiled);
}

function getPageModule(key) {
  // look for custom page first, then fall back to default
  try { var Page = require("../js/compile-" + key); }
  catch(e) { var Page = require("../js/compile-page"); }
  return Page;
}
