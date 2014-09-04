/*! Licensed under MIT, https://github.com/sofish/pen */
(function(root, doc) {

  var Pen, FakePen, debugMode, utils = {};
  var toString = Object.prototype.toString;
  var slice = Array.prototype.slice;

  // allow command list
  var commandsReg = {
    block: /^(?:p|h[1-6]|blockquote|pre)$/,
    inline: /^(?:bold|italic|underline|insertorderedlist|insertunorderedlist|indent|outdent)$/,
    source: /^(?:insertimage|createlink|unlink)$/,
    insert: /^(?:inserthorizontalrule|insert)$/,
    wrap: /^(?:code)$/
  };

  var lineBreakReg = /^(?:blockquote|pre|div)$/i;

  var effectNodeReg = /(?:[pubia]|h[1-6]|blockquote|[uo]l|li)/i;

  var strReg = {
    whiteSpace: /(^\s+)|(\s+$)/g,
    mailTo: /^(?!mailto:|.+\/|.+#|.+\?)(.*@.*\..+)$/,
    http: /^(?!\w+?:\/\/|mailto:|\/|\.\/|\?|#)(.*)$/
  };

  // type detect
  utils.is = function(obj, type) {
    return toString.call(obj).slice(8, -1) === type;
  };

  utils.forEach = function(obj, iterator, arrayLike) {
    if (!obj) return;
    if (arrayLike == null) arrayLike = utils.is(obj, 'Array');
    if(arrayLike) {
      for (var i = 0, l = obj.length; i < l; i++) iterator(obj[i], i, obj);
    } else {
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) iterator(obj[key], key, obj);
      }
    }
  };

  // copy props from a obj
  utils.copy = function(defaults, source) {
    utils.forEach(source, function (value, key) {
      defaults[key] = utils.is(value, 'Object') ? utils.copy({}, value) :
        utils.is(value, 'Array') ? utils.copy([], value) : value;
    });
    return defaults;
  };

  // log
  utils.log = function(message, force) {
    if(debugMode || force) console.log('%cPEN DEBUGGER: %c' + message, 'font-family:arial,sans-serif;color:#1abf89;line-height:2em;', 'font-family:cursor,monospace;color:#333;');
  };

  utils.delayExec = function (fn) {
    var timer = null;
    return function (delay) {
      clearTimeout(timer);
      timer = setTimeout(function() {
        fn();
      }, delay || 1);
    };
  };

  // merge: make it easy to have a fallback
  utils.merge = function(config) {

    // default settings
    var defaults = {
      class: 'pen',
      debug: false,
      stay: config.stay || !config.debug,
      stayMsg: 'Are you going to leave here?',
      textarea: '<textarea name="content"></textarea>',
      list: [
        'blockquote', 'h2', 'h3', 'p', 'code', 'insertorderedlist', 'insertunorderedlist', 'inserthorizontalrule',
        'indent', 'outdent', 'bold', 'italic', 'underline', 'createlink'
      ],
      cleanAttrs: ['id', 'class', 'style', 'name'],
      cleanTags: ['script']
    };

    // user-friendly config
    if(config.nodeType === 1) {
      defaults.editor = config;
    } else if(config.match && config.match(/^#[\S]+$/)) {
      defaults.editor = doc.getElementById(config.slice(1));
    } else {
      defaults = utils.copy(defaults, config);
    }

    return defaults;
  };

  function commandOverall(ctx, cmd, val) {
    var message = ' to exec 「' + cmd + '」 command' + (val ? (' with value: ' + val) : '');
    if(doc.execCommand(cmd, false, val)) {
      utils.log('success' + message);
    } else {
      utils.log('fail' + message, true);
    }
  }

  function commandInsert(ctx, name) {
    var node = currentNode(ctx);
    if (!node) return;
    ctx._range.selectNode(node);
    ctx._range.collapse(false);
    return commandOverall(ctx, name);
  }

  function commandBlock(ctx, name) {
    var list = effectNode(ctx, currentNode(ctx), true);
    if(list.indexOf(name) !== -1) name = 'p';
    return commandOverall(ctx, 'formatblock', name);
  }

  function commandWrap(ctx, tag) {
    var val = '<' + tag + '>' + ctx._sel + '</' + tag + '>';
    return commandOverall(ctx, 'insertHTML', val);
  }

  // placeholder
  function initPlaceholder(ctx) {
    var editor = ctx.config.editor;

    ctx._placeholder = editor.getAttribute('data-placeholder');
    ctx.placeholder();
  }

  function initToolbar(ctx) {
    var icons = '';

    utils.forEach(ctx.config.list, function (name) {
      var klass = 'pen-icon icon-' + name;
      icons += '<i class="' + klass + '" data-action="' + name + '"></i>';
      if((name === 'createlink')) icons += '<input class="pen-input" placeholder="http://" />';
    }, true);

    ctx._menu = doc.createElement('div');
    ctx._menu.setAttribute('class', ctx.config.class + '-menu pen-menu');
    ctx._menu.innerHTML = icons;
    ctx._menu.style.display = 'none';

    doc.body.appendChild(ctx._menu);
  }

  function initEvents(ctx) {
    var menu = ctx._menu, editor = ctx.config.editor, sel = ctx._sel;

    var setpos = function() {
      if(menu.style.display === 'block') ctx.menu();
    };

    // change menu offset when window resize / scroll
    addListener(ctx, window, 'resize', setpos);
    addListener(ctx, window, 'scroll', setpos);

    var toggleMenu = utils.delayExec(function() {
      if(!sel.isCollapsed) {
        //show menu
        ctx.menu().highlight();
      } else {
        //hide menu
        ctx._menu.style.display = 'none';
      }
    });

    var toggle = function(delay) {
      ctx._range = ctx.getRange();
      toggleMenu(delay);
    };

    // toggle toolbar on mouse select
    var selecting = false;
    addListener(ctx, editor, 'mousedown', function () {
      selecting = true;
    });
    addListener(ctx, editor, 'mouseleave', function () {
      if (selecting) toggle(400);
      selecting = false;
    });
    addListener(ctx, editor, 'mouseup', function () {
      if (selecting) toggle(0);
      selecting = false;
    });

    // toggle toolbar on key select
    addListener(ctx, editor, 'keyup', function (e) {
      if (e.which === 8 && ctx.isEmpty()) {
        editor.innerHTML = '<p><br></p>';
        ctx._menu.style.display = 'none';
        ctx.setRange();
      } else toggle(400);
    });

    // breakout from node
    var lineBreak = function (ctx, node) {
      var range = ctx._range;
      range.setStartAfter(node);
      range.setEndAfter(node);
      node = doc.createElement('p');
      node.innerHTML = '<br>';
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      ctx.setRange(range);
      commandOverall(ctx, 'formatblock', 'p');
    };

    // check line break
    addListener(ctx, editor, 'keydown', function (e) {
      if (e.which !== 13 || e.shiftKey) return;
      var node = currentNode(ctx, true);
      if (lineBreakReg.test(node.nodeName)) {
        e.preventDefault();
        lineBreak(ctx, node);
      }
    });

    var menuApply = function(action, value) {
      ctx.execCommand(action, value);
      ctx._range = ctx.getRange();
      if(!sel.isCollapsed) ctx.highlight().menu();
    };

    // toggle toolbar on key select
    addListener(ctx, menu, 'click', function(e) {
      var action = e.target.getAttribute('data-action');

      if(!action) return;
      if(action !== 'createlink') return menuApply(action);
      // create link
      var input = menu.getElementsByTagName('input')[0];

      input.style.display = 'block';
      input.focus();

      var createlink = function(input) {
        input.style.display = 'none';
        if(input.value) {
          var inputValue = input.value
            .replace(strReg.whiteSpace, '')
            .replace(strReg.mailTo, 'mailto:$1')
            .replace(strReg.http, 'http://$1');
          return menuApply(action, inputValue);
        }
        action = 'unlink';
        menuApply(action);
      };

      input.onkeypress = function(e) {
        if(e.which === 13) return createlink(e.target);
      };

    });

    // listen for placeholder
    addListener(ctx, editor, 'focus', function() {
      if(editor.classList.contains('pen-placeholder') || ctx.isEmpty()) editor.innerHTML = '<p><br></p>';
      editor.classList.remove('pen-placeholder');
    });

    addListener(ctx, editor, 'blur', function() {
      ctx.placeholder();
      ctx.checkContentChange();
    });

    // listen for paste and clear style
    addListener(ctx, editor, 'paste', function() {
      setTimeout(function() {
        ctx.cleanContent();
      });
    });
  }

  function addListener(ctx, target, type, listener) {
    if (ctx._events.hasOwnProperty(type)) {
      ctx._events[type].push(listener);
    } else {
      ctx._eventTargets = ctx._eventTargets || [];
      ctx._eventsCache = ctx._eventsCache || [];
      var index = ctx._eventTargets.indexOf(target);
      if(index < 0) index = ctx._eventTargets.push(target) - 1;
      ctx._eventsCache[index] = ctx._eventsCache[index] || {};
      ctx._eventsCache[index][type] = ctx._eventsCache[index][type] || [];
      ctx._eventsCache[index][type].push(listener);

      target.addEventListener(type, listener, false);
    }
    return ctx;
  }

  // trigger local events
  function triggerListener(ctx, type) {
    if (!ctx._events.hasOwnProperty(type)) return;
    var args = slice.call(arguments, 2);
    utils.forEach(ctx._events[type], function (listener) {
      listener.apply(ctx, args);
    });
  }

  function removeAllListeners(ctx) {
    utils.forEach(this._events, function (events) {
      events.length = 0;
    }, false);
    if (!ctx._eventsCache) return ctx;
    utils.forEach(ctx._eventsCache, function (events, index) {
      var target = ctx._eventTargets[index];
      utils.forEach(events, function (listeners, type) {
        utils.forEach(listeners, function (listener) {
          target.removeEventListener(type, listener, false);
        }, true);
      }, false);
    }, true);
    ctx._eventTargets = [];
    ctx._eventsCache = [];
    return ctx;
  }

  function currentNode(ctx, byRoot) {
    var node, root = ctx.config.editor;
    ctx._range = ctx._range || ctx.getRange();
    node = ctx._range.startContainer;
    if (node === root) return node;
    while(node && (node.nodeType !== 1) && (node.parentNode !== root)) node = node.parentNode;
    while(node && byRoot && (node.parentNode !== root)) node = node.parentNode;
    return node;
  }

  // node effects
  function effectNode(ctx, el, returnAsNodeName) {
    var nodes = [];
    el = el || ctx.config.editor;
    while(el !== ctx.config.editor) {
      if(el.nodeName.match(effectNodeReg)) {
        nodes.push(returnAsNodeName ? el.nodeName.toLowerCase() : el);
      }
      el = el.parentNode;
    }
    return nodes;
  }

  Pen = function(config) {

    if(!config) throw new Error('Can\'t find config');

    debugMode = config.debug;

    // merge user config
    var defaults = utils.merge(config);

    var editor = defaults.editor;

    if(!editor || editor.nodeType !== 1) throw new Error('Can\'t find editor');

    // set default class
    editor.classList.add(defaults.class);

    // set contenteditable
    editor.setAttribute('contenteditable', 'true');

    // assign config
    this.config = defaults;

    // save the selection obj
    this._sel = doc.getSelection();

    // define local events
    this._events = {change: []};

    // enable toolbar
    initToolbar(this);

    // init placeholder
    initPlaceholder(this);

    // init events
    initEvents(this);

    // to check content change
    this._prevContent = this.getContent();

    // enable markdown covert
    if (this.markdown) this.markdown.init(this);

    // stay on the page
    if (this.config.stay) this.stay(this.config);

  };

  Pen.prototype.on = function(type, listener) {
    addListener(this, this.config.editor, type, listener);
    return this;
  };

  Pen.prototype.placeholder = function(placeholder) {
    var editor = this.config.editor;
    if(placeholder) this._placeholder = placeholder + '';

    if(this._placeholder && (editor.classList.contains('pen-placeholder') || this.isEmpty())) {
      editor.innerHTML = this._placeholder;
      editor.classList.add('pen-placeholder');
      return true;
    }
    editor.classList.remove('pen-placeholder');
    return false;
  };

  Pen.prototype.isEmpty = function(node) {
    node = node || this.config.editor;
    return !(!node.innerText || node.innerText.trim() || node.querySelectorAll('img').length);
  };

  Pen.prototype.getContent = function() {
    var editor = this.config.editor;
    if(editor.classList.contains('pen-placeholder') || this.isEmpty()) return '';
    return editor.innerHTML;
  };

  Pen.prototype.setContent = function(html) {
    this.config.editor.innerHTML = html;
    this.cleanContent();
    return this;
  };

  Pen.prototype.checkContentChange = function () {
    var prevContent = this._prevContent, currentContent = this.getContent();
    if (prevContent === currentContent) return;
    this._prevContent = currentContent;
    triggerListener(this, 'change', currentContent, prevContent);
  };

  Pen.prototype.getRange = function() {
    var sel = this._sel;
    return (sel.rangeCount && sel.getRangeAt(0)) || null;
  };

  Pen.prototype.setRange = function(range) {
    var sel = this._sel;
    range = range || this._range;
    if (!range) {
      range = this.getRange();
      if (range) range.collapse(false); // set to end
    }
    if (range) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return this;
  };

  Pen.prototype.focus = function(focusStart) {
    this.config.editor.focus();
    if(!focusStart) this.setRange();
    return this;
  };

  Pen.prototype.execCommand = function(name, value) {
    name = name.toLowerCase();
    this.setRange();
    if(commandsReg.block.test(name)) {
      commandBlock(this, name);
    } else if(commandsReg.inline.test(name) || commandsReg.source.test(name)) {
      commandOverall(this, name, value);
    } else if(commandsReg.insert.test(name)) {
      commandInsert(this, name);
    } else if(commandsReg.wrap.test(name)) {
      commandWrap(this, name);
    } else {
      utils.log('can not find command function for name: ' + name + (value ? (', value: ' + value) : ''), true);
    }
    if (name === 'indent') this.checkContentChange();
    else this.cleanContent({cleanAttrs: ['style']});
  };

  // remove attrs and tags
  // pen.cleanContent({cleanAttrs: ['style'], cleanTags: ['id']})
  Pen.prototype.cleanContent = function(options) {
    var editor = this.config.editor;

    if (!options) options = this.config;
    utils.forEach(options.cleanAttrs, function (attr) {
      utils.forEach(editor.querySelectorAll('[' + attr + ']'), function(item) {
        item.removeAttribute(attr);
      }, true);
    }, true);
    utils.forEach(options.cleanTags, function (tag) {
      utils.forEach(editor.querySelectorAll(tag), function(item) {
        item.parentNode.removeChild(item);
      }, true);
    }, true);

    this.placeholder();
    this.checkContentChange();
    return this;
  };

  // highlight menu
  Pen.prototype.highlight = function() {
    var node = this._sel.focusNode
      , effects = effectNode(this, node)
      , menu = this._menu
      , linkInput = menu.querySelector('input')
      , highlight;

    // remove all highlights
    utils.forEach(menu.querySelectorAll('.active'), function(el) {
      el.classList.remove('active');
    }, true);

    if (linkInput) {
      // display link input if createlink enabled
      linkInput.style.display = 'none';
      // reset link input value
      linkInput.value = '';
    }

    highlight = function(str) {
      var selector = '.icon-' + str
        , el = menu.querySelector(selector);
      return el && el.classList.add('active');
    };

    utils.forEach(effects, function(item) {
      var tag = item.nodeName.toLowerCase();
      switch(tag) {
        case 'a':
          menu.querySelector('input').value = item.getAttribute('href');
          tag = 'createlink';
          break;
        case 'i':
          tag = 'italic';
          break;
        case 'u':
          tag = 'underline';
          break;
        case 'b':
          tag = 'bold';
          break;
        case 'code':
          tag = 'code';
          break;
        case 'ul':
          tag = 'insertunorderedlist';
          break;
        case 'ol':
          tag = 'insertorderedlist';
          break;
        case 'ol':
          tag = 'insertorderedlist';
          break;
        case 'li':
          tag = 'indent';
          break;
      }
      highlight(tag);
    }, true);

    return this;
  };

  // show menu
  Pen.prototype.menu = function() {

    var offset = this._range.getBoundingClientRect()
      , menuPadding = 10
      , top = offset.top - menuPadding
      , left = offset.left + (offset.width / 2)
      , menu = this._menu
      , menuOffset = {x: 0, y: 0}
      , stylesheet = this._stylesheet;

    // store the stylesheet used for positioning the menu horizontally
    if(this._stylesheet === undefined) {
      var style = document.createElement("style");
      document.head.appendChild(style);
      this._stylesheet = stylesheet = style.sheet;
    }
    // display block to caculate its width & height
    menu.style.display = 'block';

    menuOffset.x = left - (menu.clientWidth / 2);
    menuOffset.y = top - menu.clientHeight;

    // check to see if menu has over-extended its bounding box. if it has,
    // 1) apply a new class if overflowed on top;
    // 2) apply a new rule if overflowed on the left
    if(stylesheet.cssRules.length > 0) {
      stylesheet.deleteRule(0);
    }
    if(menuOffset.x < 0) {
      menuOffset.x = 0;
      stylesheet.insertRule('.pen-menu:after {left: ' + left + 'px;}', 0);
    } else {
      stylesheet.insertRule('.pen-menu:after {left: 50%; }', 0);
    }
    if(menuOffset.y < 0) {
      menu.classList.toggle('pen-menu-below', true);
      menuOffset.y = offset.top + offset.height + menuPadding;
    } else {
      menu.classList.toggle('pen-menu-below', false);
    }

    menu.style.top = menuOffset.y + 'px';
    menu.style.left = menuOffset.x + 'px';
    return this;
  };

  Pen.prototype.stay = function(config) {
    var ctx = this;
    if (!window.onbeforeunload) {
      window.onbeforeunload = function() {
        if(!ctx._isDestroyed) return config.stayMsg;
      };
    }
  };

  Pen.prototype.destroy = function(isAJoke) {
    var destroy = isAJoke ? false : true
      , attr = isAJoke ? 'setAttribute' : 'removeAttribute';

    if(!isAJoke) {
      removeAllListeners(this);
      this._sel.removeAllRanges();
      this._menu.parentNode.removeChild(this._menu);
    } else {
      initToolbar(this);
      initPlaceholder(this);
      initEvents(this);
    }
    this._isDestroyed = destroy;
    this.config.editor[attr]('contenteditable', '');

    return this;
  };

  Pen.prototype.rebuild = function() {
    return this.destroy('it\'s a joke');
  };

  // a fallback for old browers
  FakePen = function(config) {
    if(!config) return utils.log('can\'t find config', true);

    var defaults = utils.merge(config)
      , klass = defaults.editor.getAttribute('class');

    klass = klass ? klass.replace(/\bpen\b/g, '') + ' pen-textarea ' + defaults.class : 'pen pen-textarea';
    defaults.editor.setAttribute('class', klass);
    defaults.editor.innerHTML = defaults.textarea;
    return defaults.editor;
  };

  // make it accessible
  root.Pen = doc.getSelection ? Pen : FakePen;

}(window, document));
