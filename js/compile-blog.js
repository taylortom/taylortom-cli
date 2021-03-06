var _ = require("underscore");
var async = require("async");
var fs = require("fs-extra");
var h2p = require('html2plaintext');
var path = require("path");

var Page = require("./compile-page");
var config = require("../js/config");
var logger = require("../js/logger");
var mdRenderer = require("../js/mdRenderer");
var utils = require("../js/utils");

var Blog = module.exports = function(id, data, args) {
  Page.call(this, id, data);
  this.type = "blog";
  this.includeDrafts = args.drafts || args.d;
};

Blog.prototype = Object.create(Page.prototype);
Blog.prototype.contructor = Blog;

// load all .md posts
Blog.prototype.getPosts = function(dir, cbGotPosts) {
  fs.readdir(dir, _.bind(function onRead(error, files) {
    if(error || files.length === 0) return cbGotPosts(error);
    var posts = [];
    async.forEachOf(utils.fileFilter(files, { type: ".md" }), _.bind(function iterator(file, index, cbDoneLoop) {
      fs.readFile(path.join(dir, file), "utf-8", _.bind(function onRead(error, mdData) {
        if(error) return cbGotPosts(error);
        try {
          var postData = {};
          this.parseMetaData(mdData, postData);
          postData.body = mdRenderer(mdData.replace(/.*}]/, ""));
          posts.push(postData);
        } catch(e) {
          logger.warn("Skipping " + logger.file(file) + ", invalid metadata (" + e + ")");
        }
        cbDoneLoop();
      }, this));
    }, this), function(error) {
      cbGotPosts(error, posts);
    });
  }, this));
};

// sorts and assigns page numbers
Blog.prototype.organisePosts = function() {
  if(!this.posts || this.posts.length < 2) return;
  // reverse chronological
  this.posts.sort(function(a,b) { return (a.published < b.published) ? 1 : -1; });

  var conf = config.pages.blog;
  for (var i = 0, len = this.posts.length; i < len; i++) {
    this.posts[i].page = (conf.paginate) ? Math.floor(i/conf.paginate.pageSize)+1 : 1;
  }
};

Blog.prototype.getTagData = function(cbGotTagData) {
  var sorted = {};
  async.each(this.posts, _.bind(function iterator(post, cbDoneLoop) {
    async.each(post.tags, _.bind(function iterator(tag, cbDoneLoop2) {
      if(!sorted[tag]) sorted[tag] = [ post ];
      else sorted[tag].push(post);
      cbDoneLoop2();
    }, this), cbDoneLoop);
  }, this), function(error) {
    cbGotTagData(error, sorted);
  });
};

Blog.prototype.parseMetaData = function(mdData, postData) {
  var metaReg = /(\[!META(\{.*\})\])/;
  var metaData = JSON.parse(mdData.match(metaReg)[2]);
  for(var key in metaData) postData[key] = metaData[key];
  // validate
  async.each(['id','title','published','tags'], function(field, cb) {
    if(!metaData.hasOwnProperty(field)) throw new Error('Missing ' + field);
    cb();
  }, function() {
    postData.published = new Date(metaData.published);
    var datePrefix = utils.formatDate(postData.published, "YYYY/MM/DD").replace(/\//g,path.sep);
    // add folder location for permalinks and writing posts later
    postData.dir = path.join(datePrefix, postData.id + path.sep);
  });
};

Page.prototype.writeArchive = function(cbArchiveWritten) {
  var model = this.getModel({
    title: {
      text: this.pages.archive.title,
      show: true
    },
    description: this.pages.archive.description
  });
  var outputDir = path.join(config._OUTPUT_DIR, this.rootDir, "archive");
  this.writePage(model, this.templateData.pages.archive, "index.html", outputDir, cbArchiveWritten);
};

Blog.prototype.writePosts = function(cbPostsWritten) {
  async.each(this.posts, _.bind(function iterator(post, cbDoneLoop) {
    var model = this.getModel({ postModel: post });
    var outputDir = path.join(config._OUTPUT_DIR, this.rootDir, post.dir);
    this.writePage(model, this.templateData.pages.posts, "index.html", outputDir, cbDoneLoop);
  }, this), cbPostsWritten);
};

Blog.prototype.writeTags = function(cbTagsWritten) {
  this.getTagData(_.bind(function(error, tagData) {
    async.forEachOf(tagData, _.bind(function iterator(tag, key, cbDoneLoop) {
      var model = this.getModel({
        title: {
          text: this.pages.tags.title.replace("[TAG]", key),
          show: true
        },
        tagData: tag
      });
      var outputDir = path.join(config._OUTPUT_DIR, this.rootDir, key);
      this.writePage(model, this.templateData.pages.tags, "index.html", outputDir, cbDoneLoop);
    }, this), cbTagsWritten);
  }, this));
};

Blog.prototype.writeFeed = function(cbFeedWritten) {
  var noOfpages = Math.ceil(this.posts.length/this.feed.pageSize);
  async.times(noOfpages, _.bind(this.writeFeedPage, this), function(error) {
    if(!error) logger.debug("JSON blog Feed created");
    cbFeedWritten(error);
  });
};

Blog.prototype.writeFeedPage = function(pageNo, cbFeedPageWritten) {
  var pageUrl = `${config.server.url}${this.rootDir}`;
  var postPageData = this.getFeedPostData(pageNo);
  var feed = {
    version: "https://jsonfeed.org/version/1",
    title: this.feed.title,
    home_page_url: pageUrl,
    feed_url: `${pageUrl}/feed.json`,
    description: this.feed.description,
    icon: this.feed.icon,
    author: {
      name: this.feed.author.name,
      url: config.server.url,
      avatar: this.feed.author.avatar
    },
    items: postPageData.posts
  };
  if(postPageData.nextPage) {
    feed.next_url = `${pageUrl}/${postPageData.nextPage}`;
  }
  var filename = 'feed' + ((pageNo > 0) ? pageNo : '') + '.json';
  fs.writeJson(path.join(config._OUTPUT_DIR, this.rootDir, filename), feed, cbFeedPageWritten);
};

Blog.prototype.getFeedPostData = function(pageNo) {
  var startIndex = this.feed.pageSize*pageNo;
  var endIndex = startIndex+this.feed.pageSize;
  var posts = this.posts.slice(startIndex, endIndex).map(_.bind(function(post) {
    return {
      id: post.id,
      url: `${config.server.url}${this.rootDir}/${post.dir}`,
      title: post.title,
      content_html: post.body,
      content_text: h2p(post.body),
      // TODO support summary
      // summary: post.summary,
      date_published: post.published,
      tags: post.tags
    };
  }, this));
  return {
    posts: posts,
    nextPage: (endIndex < this.posts.length) ? `feed${++pageNo}.json` : ''
  }
};

/*
* OVERRIDES START HERE...
*/

Blog.prototype.loadData = function(cbDataLoaded) {
  Page.prototype.loadData.call(this, _.bind(function loadedData(error) {
    if(error) return cbDataLoaded(error);
    this.rootDir = path.sep + this.id;
    this.posts = [];
    //  TODO refactor this
    async.parallel([
      _.bind(function(cbDone) {
        this.getPosts(config._POSTS_DIR, _.bind(function(error, postData) {
          if(error) return cbDone(error);
          this.posts = this.posts.concat(postData);
          cbDone();
        }, this));
      }, this),
      _.bind(function(cbDone) {
        if(!this.includeDrafts) return cbDone();
        this.getPosts(config._DRAFTS_DIR, _.bind(function(error, postData) {
          if(error) return cbDone(error);
          this.posts = this.posts.concat(postData);
          cbDone();
        }, this));
      }, this),
    ], _.bind(function doneLoop(error) {
      if(error) cbDataLoaded(error);
      this.organisePosts();
      cbDataLoaded();
    }, this));
  }, this));
};

Blog.prototype.write = function(cbWritten) {
  Page.prototype.write.call(this, _.bind(function loadedData(error) {
    if(error) return cbWritten(error);
    this.writeFeed(cbWritten);
  }, this));
};
