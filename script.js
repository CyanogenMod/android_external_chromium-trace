// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const cr = (function() {

  /**
   * Whether we are using a Mac or not.
   * @type {boolean}
   */
  const isMac = /Mac/.test(navigator.platform);

  /**
   * Whether this is on the Windows platform or not.
   * @type {boolean}
   */
  const isWindows = /Win/.test(navigator.platform);

  /**
   * Whether this is on chromeOS or not.
   * @type {boolean}
   */
  const isChromeOS = /CrOS/.test(navigator.userAgent);

  /**
   * Whether this is on vanilla Linux (not chromeOS).
   * @type {boolean}
   */
  const isLinux = /Linux/.test(navigator.userAgent);

  /**
   * Whether this uses GTK or not.
   * @type {boolean}
   */
  const isGTK = /GTK/.test(chrome.toolkit);

  /**
   * Whether this uses the views toolkit or not.
   * @type {boolean}
   */
  const isViews = /views/.test(chrome.toolkit);

  /**
   * Whether this window is optimized for touch-based input.
   * @type {boolean}
   */
  const isTouchOptimized = !!chrome.touchOptimized;

  /**
   * Sets the os and toolkit attributes in the <html> element so that platform
   * specific css rules can be applied.
   */
  function enablePlatformSpecificCSSRules() {
    if (isMac)
      doc.documentElement.setAttribute('os', 'mac');
    if (isWindows)
      doc.documentElement.setAttribute('os', 'windows');
    if (isChromeOS)
      doc.documentElement.setAttribute('os', 'chromeos');
    if (isLinux)
      doc.documentElement.setAttribute('os', 'linux');
    if (isGTK)
      doc.documentElement.setAttribute('toolkit', 'gtk');
    if (isViews)
      doc.documentElement.setAttribute('toolkit', 'views');
    if (isTouchOptimized)
      doc.documentElement.setAttribute('touch-optimized', '');
  }

  /**
   * Builds an object structure for the provided namespace path,
   * ensuring that names that already exist are not overwritten. For
   * example:
   * "a.b.c" -> a = {};a.b={};a.b.c={};
   * @param {string} name Name of the object that this file defines.
   * @param {*=} opt_object The object to expose at the end of the path.
   * @param {Object=} opt_objectToExportTo The object to add the path to;
   *     default is {@code window}.
   * @private
   */
  function exportPath(name, opt_object, opt_objectToExportTo) {
    var parts = name.split('.');
    var cur = opt_objectToExportTo || window /* global */;

    for (var part; parts.length && (part = parts.shift());) {
      if (!parts.length && opt_object !== undefined) {
        // last part and we have an object; use it
        cur[part] = opt_object;
      } else if (part in cur) {
        cur = cur[part];
      } else {
        cur = cur[part] = {};
      }
    }
    return cur;
  };

  // cr.Event is called CrEvent in here to prevent naming conflicts. We also
  // store the original Event in case someone does a global alias of cr.Event.
  const DomEvent = Event;

  /**
   * Creates a new event to be used with cr.EventTarget or DOM EventTarget
   * objects.
   * @param {string} type The name of the event.
   * @param {boolean=} opt_bubbles Whether the event bubbles. Default is false.
   * @param {boolean=} opt_preventable Whether the default action of the event
   *     can be prevented.
   * @constructor
   * @extends {DomEvent}
   */
  function CrEvent(type, opt_bubbles, opt_preventable) {
    var e = cr.doc.createEvent('Event');
    e.initEvent(type, !!opt_bubbles, !!opt_preventable);
    e.__proto__ = CrEvent.prototype;
    return e;
  }

  CrEvent.prototype = {
    __proto__: DomEvent.prototype
  };

  /**
   * Fires a property change event on the target.
   * @param {EventTarget} target The target to dispatch the event on.
   * @param {string} propertyName The name of the property that changed.
   * @param {*} newValue The new value for the property.
   * @param {*} oldValue The old value for the property.
   */
  function dispatchPropertyChange(target, propertyName, newValue, oldValue) {
    var e = new CrEvent(propertyName + 'Change');
    e.propertyName = propertyName;
    e.newValue = newValue;
    e.oldValue = oldValue;
    target.dispatchEvent(e);
  }

  /**
   * Converts a camelCase javascript property name to a hyphenated-lower-case
   * attribute name.
   * @param {string} jsName The javascript camelCase property name.
   * @return {string} The equivalent hyphenated-lower-case attribute name.
   */
  function getAttributeName(jsName) {
    return jsName.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  /**
   * The kind of property to define in {@code defineProperty}.
   * @enum {number}
   */
  const PropertyKind = {
    /**
     * Plain old JS property where the backing data is stored as a "private"
     * field on the object.
     */
    JS: 'js',

    /**
     * The property backing data is stored as an attribute on an element.
     */
    ATTR: 'attr',

    /**
     * The property backing data is stored as an attribute on an element. If the
     * element has the attribute then the value is true.
     */
    BOOL_ATTR: 'boolAttr'
  };

  /**
   * Helper function for defineProperty that returns the getter to use for the
   * property.
   * @param {string} name
   * @param {cr.PropertyKind} kind
   * @return {function():*} The getter for the property.
   */
  function getGetter(name, kind) {
    switch (kind) {
      case PropertyKind.JS:
        var privateName = name + '_';
        return function() {
          return this[privateName];
        };
      case PropertyKind.ATTR:
        var attributeName = getAttributeName(name);
        return function() {
          return this.getAttribute(attributeName);
        };
      case PropertyKind.BOOL_ATTR:
        var attributeName = getAttributeName(name);
        return function() {
          return this.hasAttribute(attributeName);
        };
    }
  }

  /**
   * Helper function for defineProperty that returns the setter of the right
   * kind.
   * @param {string} name The name of the property we are defining the setter
   *     for.
   * @param {cr.PropertyKind} kind The kind of property we are getting the
   *     setter for.
   * @param {function(*):void} opt_setHook A function to run after the property
   *     is set, but before the propertyChange event is fired.
   * @return {function(*):void} The function to use as a setter.
   */
  function getSetter(name, kind, opt_setHook) {
    switch (kind) {
      case PropertyKind.JS:
        var privateName = name + '_';
        return function(value) {
          var oldValue = this[privateName];
          if (value !== oldValue) {
            this[privateName] = value;
            if (opt_setHook)
              opt_setHook.call(this, value, oldValue);
            dispatchPropertyChange(this, name, value, oldValue);
          }
        };

      case PropertyKind.ATTR:
        var attributeName = getAttributeName(name);
        return function(value) {
          var oldValue = this[attributeName];
          if (value !== oldValue) {
            if (value == undefined)
              this.removeAttribute(attributeName);
            else
              this.setAttribute(attributeName, value);
            if (opt_setHook)
              opt_setHook.call(this, value, oldValue);
            dispatchPropertyChange(this, name, value, oldValue);
          }
        };

      case PropertyKind.BOOL_ATTR:
        var attributeName = getAttributeName(name);
        return function(value) {
          var oldValue = this[attributeName];
          if (value !== oldValue) {
            if (value)
              this.setAttribute(attributeName, name);
            else
              this.removeAttribute(attributeName);
            if (opt_setHook)
              opt_setHook.call(this, value, oldValue);
            dispatchPropertyChange(this, name, value, oldValue);
          }
        };
    }
  }

  /**
   * Defines a property on an object. When the setter changes the value a
   * property change event with the type {@code name + 'Change'} is fired.
   * @param {!Object} obj The object to define the property for.
   * @param {string} name The name of the property.
   * @param {cr.PropertyKind=} opt_kind What kind of underlying storage to use.
   * @param {function(*):void} opt_setHook A function to run after the
   *     property is set, but before the propertyChange event is fired.
   */
  function defineProperty(obj, name, opt_kind, opt_setHook) {
    if (typeof obj == 'function')
      obj = obj.prototype;

    var kind = opt_kind || PropertyKind.JS;

    if (!obj.__lookupGetter__(name)) {
      obj.__defineGetter__(name, getGetter(name, kind));
    }

    if (!obj.__lookupSetter__(name)) {
      obj.__defineSetter__(name, getSetter(name, kind, opt_setHook));
    }
  }

  /**
   * Counter for use with createUid
   */
  var uidCounter = 1;

  /**
   * @return {number} A new unique ID.
   */
  function createUid() {
    return uidCounter++;
  }

  /**
   * Returns a unique ID for the item. This mutates the item so it needs to be
   * an object
   * @param {!Object} item The item to get the unique ID for.
   * @return {number} The unique ID for the item.
   */
  function getUid(item) {
    if (item.hasOwnProperty('uid'))
      return item.uid;
    return item.uid = createUid();
  }

  /**
   * Dispatches a simple event on an event target.
   * @param {!EventTarget} target The event target to dispatch the event on.
   * @param {string} type The type of the event.
   * @param {boolean=} opt_bubbles Whether the event bubbles or not.
   * @param {boolean=} opt_cancelable Whether the default action of the event
   *     can be prevented.
   * @return {boolean} If any of the listeners called {@code preventDefault}
   *     during the dispatch this will return false.
   */
  function dispatchSimpleEvent(target, type, opt_bubbles, opt_cancelable) {
    var e = new cr.Event(type, opt_bubbles, opt_cancelable);
    return target.dispatchEvent(e);
  }

  /**
   * @param {string} name
   * @param {!Function} fun
   */
  function define(name, fun) {
    var obj = exportPath(name);
    var exports = fun();
    for (var propertyName in exports) {
      // Maybe we should check the prototype chain here? The current usage
      // pattern is always using an object literal so we only care about own
      // properties.
      var propertyDescriptor = Object.getOwnPropertyDescriptor(exports,
                                                               propertyName);
      if (propertyDescriptor)
        Object.defineProperty(obj, propertyName, propertyDescriptor);
    }
  }

  /**
   * Document used for various document related operations.
   * @type {!Document}
   */
  var doc = document;


  /**
   * Allows you to run func in the context of a different document.
   * @param {!Document} document The document to use.
   * @param {function():*} func The function to call.
   */
  function withDoc(document, func) {
    var oldDoc = doc;
    doc = document;
    try {
      func();
    } finally {
      doc = oldDoc;
    }
  }

  /**
   * Adds a {@code getInstance} static method that always return the same
   * instance object.
   * @param {!Function} ctor The constructor for the class to add the static
   *     method to.
   */
  function addSingletonGetter(ctor) {
    ctor.getInstance = function() {
      return ctor.instance_ || (ctor.instance_ = new ctor());
    };
  }

  return {
    addSingletonGetter: addSingletonGetter,
    isChromeOS: isChromeOS,
    isMac: isMac,
    isWindows: isWindows,
    isLinux: isLinux,
    isViews: isViews,
    isTouchOptimized: isTouchOptimized,
    enablePlatformSpecificCSSRules: enablePlatformSpecificCSSRules,
    define: define,
    defineProperty: defineProperty,
    PropertyKind: PropertyKind,
    createUid: createUid,
    getUid: getUid,
    dispatchSimpleEvent: dispatchSimpleEvent,
    dispatchPropertyChange: dispatchPropertyChange,

    /**
     * The document that we are currently using.
     * @type {!Document}
     */
    get doc() {
      return doc;
    },
    withDoc: withDoc,
    Event: CrEvent
  };
})();
// Copyright (c) 2010 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview This contains an implementation of the EventTarget interface
 * as defined by DOM Level 2 Events.
 */

cr.define('cr', function() {

  /**
   * Creates a new EventTarget. This class implements the DOM level 2
   * EventTarget interface and can be used wherever those are used.
   * @constructor
   */
  function EventTarget() {
  }

  EventTarget.prototype = {

    /**
     * Adds an event listener to the target.
     * @param {string} type The name of the event.
     * @param {!Function|{handleEvent:Function}} handler The handler for the
     *     event. This is called when the event is dispatched.
     */
    addEventListener: function(type, handler) {
      if (!this.listeners_)
        this.listeners_ = Object.create(null);
      if (!(type in this.listeners_)) {
        this.listeners_[type] = [handler];
      } else {
        var handlers = this.listeners_[type];
        if (handlers.indexOf(handler) < 0)
          handlers.push(handler);
      }
    },

    /**
     * Removes an event listener from the target.
     * @param {string} type The name of the event.
     * @param {!Function|{handleEvent:Function}} handler The handler for the
     *     event.
     */
    removeEventListener: function(type, handler) {
      if (!this.listeners_)
        return;
      if (type in this.listeners_) {
        var handlers = this.listeners_[type];
        var index = handlers.indexOf(handler);
        if (index >= 0) {
          // Clean up if this was the last listener.
          if (handlers.length == 1)
            delete this.listeners_[type];
          else
            handlers.splice(index, 1);
        }
      }
    },

    /**
     * Dispatches an event and calls all the listeners that are listening to
     * the type of the event.
     * @param {!cr.event.Event} event The event to dispatch.
     * @return {boolean} Whether the default action was prevented. If someone
     *     calls preventDefault on the event object then this returns false.
     */
    dispatchEvent: function(event) {
      if (!this.listeners_)
        return true;

      // Since we are using DOM Event objects we need to override some of the
      // properties and methods so that we can emulate this correctly.
      var self = this;
      event.__defineGetter__('target', function() {
        return self;
      });
      event.preventDefault = function() {
        this.returnValue = false;
      };

      var type = event.type;
      var prevented = 0;
      if (type in this.listeners_) {
        // Clone to prevent removal during dispatch
        var handlers = this.listeners_[type].concat();
        for (var i = 0, handler; handler = handlers[i]; i++) {
          if (handler.handleEvent)
            prevented |= handler.handleEvent.call(handler, event) === false;
          else
            prevented |= handler.call(this, event) === false;
        }
      }

      return !prevented && event.returnValue;
    }
  };

  // Export
  return {
    EventTarget: EventTarget
  };
});
// Copyright (c) 2010 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

cr.define('cr.ui', function() {

  /**
   * Decorates elements as an instance of a class.
   * @param {string|!Element} source The way to find the element(s) to decorate.
   *     If this is a string then {@code querySeletorAll} is used to find the
   *     elements to decorate.
   * @param {!Function} constr The constructor to decorate with. The constr
   *     needs to have a {@code decorate} function.
   */
  function decorate(source, constr) {
    var elements;
    if (typeof source == 'string')
      elements = cr.doc.querySelectorAll(source);
    else
      elements = [source];

    for (var i = 0, el; el = elements[i]; i++) {
      if (!(el instanceof constr))
        constr.decorate(el);
    }
  }

  /**
   * Helper function for creating new element for define.
   */
  function createElementHelper(tagName, opt_bag) {
    // Allow passing in ownerDocument to create in a different document.
    var doc;
    if (opt_bag && opt_bag.ownerDocument)
      doc = opt_bag.ownerDocument;
    else
      doc = cr.doc;
    return doc.createElement(tagName);
  }

  /**
   * Creates the constructor for a UI element class.
   *
   * Usage:
   * <pre>
   * var List = cr.ui.define('list');
   * List.prototype = {
   *   __proto__: HTMLUListElement.prototype,
   *   decorate: function() {
   *     ...
   *   },
   *   ...
   * };
   * </pre>
   *
   * @param {string|Function} tagNameOrFunction The tagName or
   *     function to use for newly created elements. If this is a function it
   *     needs to return a new element when called.
   * @return {function(Object=):Element} The constructor function which takes
   *     an optional property bag. The function also has a static
   *     {@code decorate} method added to it.
   */
  function define(tagNameOrFunction) {
    var createFunction, tagName;
    if (typeof tagNameOrFunction == 'function') {
      createFunction = tagNameOrFunction;
      tagName = '';
    } else {
      createFunction = createElementHelper;
      tagName = tagNameOrFunction;
    }

    /**
     * Creates a new UI element constructor.
     * @param {Object=} opt_propertyBag Optional bag of properties to set on the
     *     object after created. The property {@code ownerDocument} is special
     *     cased and it allows you to create the element in a different
     *     document than the default.
     * @constructor
     */
    function f(opt_propertyBag) {
      var el = createFunction(tagName, opt_propertyBag);
      f.decorate(el);
      for (var propertyName in opt_propertyBag) {
        el[propertyName] = opt_propertyBag[propertyName];
      }
      return el;
    }

    /**
     * Decorates an element as a UI element class.
     * @param {!Element} el The element to decorate.
     */
    f.decorate = function(el) {
      el.__proto__ = f.prototype;
      el.decorate();
    };

    return f;
  }

  /**
   * Input elements do not grow and shrink with their content. This is a simple
   * (and not very efficient) way of handling shrinking to content with support
   * for min width and limited by the width of the parent element.
   * @param {HTMLElement} el The element to limit the width for.
   * @param {number} parentEl The parent element that should limit the size.
   * @param {number} min The minimum width.
   */
  function limitInputWidth(el, parentEl, min) {
    // Needs a size larger than borders
    el.style.width = '10px';
    var doc = el.ownerDocument;
    var win = doc.defaultView;
    var computedStyle = win.getComputedStyle(el);
    var parentComputedStyle = win.getComputedStyle(parentEl);
    var rtl = computedStyle.direction == 'rtl';

    // To get the max width we get the width of the treeItem minus the position
    // of the input.
    var inputRect = el.getBoundingClientRect();  // box-sizing
    var parentRect = parentEl.getBoundingClientRect();
    var startPos = rtl ? parentRect.right - inputRect.right :
        inputRect.left - parentRect.left;

    // Add up border and padding of the input.
    var inner = parseInt(computedStyle.borderLeftWidth, 10) +
        parseInt(computedStyle.paddingLeft, 10) +
        parseInt(computedStyle.paddingRight, 10) +
        parseInt(computedStyle.borderRightWidth, 10);

    // We also need to subtract the padding of parent to prevent it to overflow.
    var parentPadding = rtl ? parseInt(parentComputedStyle.paddingLeft, 10) :
        parseInt(parentComputedStyle.paddingRight, 10);

    var max = parentEl.clientWidth - startPos - inner - parentPadding;

    function limit() {
      if (el.scrollWidth > max) {
        el.style.width = max + 'px';
      } else {
        el.style.width = 0;
        var sw = el.scrollWidth;
        if (sw < min) {
          el.style.width = min + 'px';
        } else {
          el.style.width = sw + 'px';
        }
      }
    }

    el.addEventListener('input', limit);
    limit();
  }

  return {
    decorate: decorate,
    define: define,
    limitInputWidth: limitInputWidth
  };
});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * The global object.
 * @type {!Object}
 */
const global = this;

/**
 * Alias for document.getElementById.
 * @param {string} id The ID of the element to find.
 * @return {HTMLElement} The found element or null if not found.
 */
function $(id) {
  return document.getElementById(id);
}

/**
 * Calls chrome.send with a callback and restores the original afterwards.
 * @param {string} name The name of the message to send.
 * @param {!Array} params The parameters to send.
 * @param {string} callbackName The name of the function that the backend calls.
 * @param {!Function} The function to call.
 */
function chromeSend(name, params, callbackName, callback) {
  var old = global[callbackName];
  global[callbackName] = function() {
    // restore
    global[callbackName] = old;

    var args = Array.prototype.slice.call(arguments);
    return callback.apply(global, args);
  };
  chrome.send(name, params);
}

/**
 * Generates a CSS url string.
 * @param {string} s The URL to generate the CSS url for.
 * @return {string} The CSS url string.
 */
function url(s) {
  // http://www.w3.org/TR/css3-values/#uris
  // Parentheses, commas, whitespace characters, single quotes (') and double
  // quotes (") appearing in a URI must be escaped with a backslash
  var s2 = s.replace(/(\(|\)|\,|\s|\'|\"|\\)/g, '\\$1');
  // WebKit has a bug when it comes to URLs that end with \
  // https://bugs.webkit.org/show_bug.cgi?id=28885
  if (/\\\\$/.test(s2)) {
    // Add a space to work around the WebKit bug.
    s2 += ' ';
  }
  return 'url("' + s2 + '")';
}

/**
 * Parses query parameters from Location.
 * @param {string} s The URL to generate the CSS url for.
 * @return {object} Dictionary containing name value pairs for URL
 */
function parseQueryParams(location) {
  var params = {};
  var query = unescape(location.search.substring(1));
  var vars = query.split("&");
  for (var i=0; i < vars.length; i++) {
    var pair = vars[i].split("=");
    params[pair[0]] = pair[1];
  }
  return params;
}

function findAncestorByClass(el, className) {
  return findAncestor(el, function(el) {
    if (el.classList)
      return el.classList.contains(className);
    return null;
  });
}

/**
 * Return the first ancestor for which the {@code predicate} returns true.
 * @param {Node} node The node to check.
 * @param {function(Node) : boolean} predicate The function that tests the
 *     nodes.
 * @return {Node} The found ancestor or null if not found.
 */
function findAncestor(node, predicate) {
  var last = false;
  while (node != null && !(last = predicate(node))) {
    node = node.parentNode;
  }
  return last ? node : null;
}

function swapDomNodes(a, b) {
  var afterA = a.nextSibling;
  if (afterA == b) {
    swapDomNodes(b, a);
    return;
  }
  var aParent = a.parentNode;
  b.parentNode.replaceChild(a, b);
  aParent.insertBefore(b, afterA);
}

/**
 * Disables text selection and dragging.
 */
function disableTextSelectAndDrag() {
  // Disable text selection.
  document.onselectstart = function(e) {
    e.preventDefault();
  }

  // Disable dragging.
  document.ondragstart = function(e) {
    e.preventDefault();
  }
}

/**
 * Check the directionality of the page.
 * @return {boolean} True if Chrome is running an RTL UI.
 */
function isRTL() {
  return document.documentElement.dir == 'rtl';
}

/**
 * Simple common assertion API
 * @param {*} condition The condition to test.  Note that this may be used to
 *     test whether a value is defined or not, and we don't want to force a
 *     cast to Boolean.
 * @param {string=} opt_message A message to use in any error.
 */
function assert(condition, opt_message) {
  'use strict';
  if (!condition) {
    var msg = 'Assertion failed';
    if (opt_message)
      msg = msg + ': ' + opt_message;
    throw new Error(msg);
  }
}

/**
 * Get an element that's known to exist by its ID. We use this instead of just
 * calling getElementById and not checking the result because this lets us
 * satisfy the JSCompiler type system.
 * @param {string} id The identifier name.
 * @return {!Element} the Element.
 */
function getRequiredElement(id) {
  var element = $(id);
  assert(element, 'Missing required element: ' + id);
  return element;
}

// Handle click on a link. If the link points to a chrome: or file: url, then
// call into the browser to do the navigation.
document.addEventListener('click', function(e) {
  // Allow preventDefault to work.
  if (!e.returnValue)
    return;

  var el = e.target;
  if (el.nodeType == Node.ELEMENT_NODE &&
      el.webkitMatchesSelector('A, A *')) {
    while (el.tagName != 'A') {
      el = el.parentElement;
    }

    if ((el.protocol == 'file:' || el.protocol == 'about:') &&
        (e.button == 0 || e.button == 1)) {
      chrome.send('navigateToUrl', [
        el.href,
        el.target,
        e.button,
        e.altKey,
        e.ctrlKey,
        e.metaKey,
        e.shiftKey
      ]);
      e.preventDefault();
    }
  }
});

/**
 * Creates a new URL which is the old URL with a GET param of key=value.
 * @param {string} url The base URL. There is not sanity checking on the URL so
 *     it must be passed in a proper format.
 * @param {string} key The key of the param.
 * @param {string} value The value of the param.
 * @return {string}
 */
function appendParam(url, key, value) {
  var param = encodeURIComponent(key) + '=' + encodeURIComponent(value);

  if (url.indexOf('?') == -1)
    return url + '?' + param;
  return url + '&' + param;
}
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.


/**
 * @fileoverview TimelineModel is a parsed representation of the
 * TraceEvents obtained from base/trace_event in which the begin-end
 * tokens are converted into a hierarchy of processes, threads,
 * subrows, and slices.
 *
 * The building block of the model is a slice. A slice is roughly
 * equivalent to function call executing on a specific thread. As a
 * result, slices may have one or more subslices.
 *
 * A thread contains one or more subrows of slices. Row 0 corresponds to
 * the "root" slices, e.g. the topmost slices. Row 1 contains slices that
 * are nested 1 deep in the stack, and so on. We use these subrows to draw
 * nesting tasks.
 *
 */
cr.define('tracing', function() {
  /**
   * A TimelineSlice represents an interval of time on a given resource plus
   * parameters associated with that interval.
   *
   * A slice is typically associated with a specific trace event pair on a
   * specific thread.
   * For example,
   *   TRACE_EVENT_BEGIN1("x","myArg", 7) at time=0.1ms
   *   TRACE_EVENT_END()                  at time=0.3ms
   * This results in a single timeline slice from 0.1 with duration 0.2 on a
   * specific thread.
   *
   * A slice can also be an interval of time on a Cpu on a TimelineCpu.
   *
   * All time units are stored in milliseconds.
   * @constructor
   */
  function TimelineSlice(title, colorId, start, args, opt_duration) {
    this.title = title;
    this.start = start;
    this.colorId = colorId;
    this.args = args;
    this.didNotFinish = false;
    this.subSlices = [];
    if (opt_duration !== undefined)
      this.duration = opt_duration;
  }

  TimelineSlice.prototype = {
    selected: false,

    duration: undefined,

    get end() {
      return this.start + this.duration;
    }
  };

  /**
   * A TimelineThread stores all the trace events collected for a particular
   * thread. We organize the slices on a thread by "subrows," where subrow 0
   * has all the root slices, subrow 1 those nested 1 deep, and so on. There
   * is also a set of non-nested subrows.
   *
   * @constructor
   */
  function TimelineThread(parent, tid) {
    this.parent = parent;
    this.tid = tid;
    this.subRows = [[]];
    this.nonNestedSubRows = [];
  }

  TimelineThread.prototype = {
    /**
     * Name of the thread, if present.
     */
    name: undefined,

    getSubrow: function(i) {
      while (i >= this.subRows.length)
        this.subRows.push([]);
      return this.subRows[i];
    },

    addNonNestedSlice: function(slice) {
      for (var i = 0; i < this.nonNestedSubRows.length; i++) {
        var currSubRow = this.nonNestedSubRows[i];
        var lastSlice = currSubRow[currSubRow.length - 1];
        if (slice.start >= lastSlice.start + lastSlice.duration) {
          currSubRow.push(slice);
          return;
        }
      }
      this.nonNestedSubRows.push([slice]);
    },

    /**
     * Updates the minTimestamp and maxTimestamp fields based on the
     * current slices and nonNestedSubRows attached to the thread.
     */
    updateBounds: function() {
      var values = [];
      var slices;
      if (this.subRows[0].length != 0) {
        slices = this.subRows[0];
        values.push(slices[0].start);
        values.push(slices[slices.length - 1].end);
      }
      for (var i = 0; i < this.nonNestedSubRows.length; ++i) {
        slices = this.nonNestedSubRows[i];
        values.push(slices[0].start);
        values.push(slices[slices.length - 1].end);
      }
      if (values.length) {
        this.minTimestamp = Math.min.apply(Math, values);
        this.maxTimestamp = Math.max.apply(Math, values);
      } else {
        this.minTimestamp = undefined;
        this.maxTimestamp = undefined;
      }
    },

    /**
     * @return {String} A user-friendly name for this thread.
     */
    get userFriendlyName() {
      var tname = this.name || this.tid;
      return this.parent.pid + ': ' + tname;
    },

    /**
     * @return {String} User friendly details about this thread.
     */
    get userFriendlyDetials() {
      return 'pid: ' + this.parent.pid +
          ', tid: ' + this.tid +
          (this.name ? ', name: ' + this.name : '');
    }

  };

  /**
   * Comparison between threads that orders first by pid,
   * then by names, then by tid.
   */
  TimelineThread.compare = function(x, y) {
    if (x.parent.pid != y.parent.pid) {
      return TimelineProcess.compare(x.parent, y.parent.pid);
    }

    if (x.name && y.name) {
      var tmp = x.name.localeCompare(y.name);
      if (tmp == 0)
        return x.tid - y.tid;
      return tmp;
    } else if (x.name) {
      return -1;
    } else if (y.name) {
      return 1;
    } else {
      return x.tid - y.tid;
    }
  };

  /**
   * Stores all the samples for a given counter.
   * @constructor
   */
  function TimelineCounter(parent, id, name) {
    this.parent = parent;
    this.id = id;
    this.name = name;
    this.seriesNames = [];
    this.seriesColors = [];
    this.timestamps = [];
    this.samples = [];
  }

  TimelineCounter.prototype = {
    __proto__: Object.prototype,

    get numSeries() {
      return this.seriesNames.length;
    },

    get numSamples() {
      return this.timestamps.length;
    },

    /**
     * Updates the bounds for this counter based on the samples it contains.
     */
    updateBounds: function() {
      if (this.seriesNames.length != this.seriesColors.length)
        throw 'seriesNames.length must match seriesColors.length';
      if (this.numSeries * this.numSamples != this.samples.length)
        throw 'samples.length must be a multiple of numSamples.';

      this.totals = [];
      if (this.samples.length == 0) {
        this.minTimestamp = undefined;
        this.maxTimestamp = undefined;
        this.maxTotal = 0;
        return;
      }
      this.minTimestamp = this.timestamps[0];
      this.maxTimestamp = this.timestamps[this.timestamps.length - 1];

      var numSeries = this.numSeries;
      var maxTotal = -Infinity;
      for (var i = 0; i < this.timestamps.length; i++) {
        var total = 0;
        for (var j = 0; j < numSeries; j++) {
          total += this.samples[i * numSeries + j];
          this.totals.push(total);
        }
        if (total > maxTotal)
          maxTotal = total;
      }

      if (this.maxTotal === undefined) {
        this.maxTotal = maxTotal;
      }
    }

  };

  /**
   * Comparison between counters that orders by pid, then name.
   */
  TimelineCounter.compare = function(x, y) {
    if (x.parent.pid != y.parent.pid) {
      return TimelineProcess.compare(x.parent, y.parent.pid);
    }
    var tmp = x.name.localeCompare(y.name);
    if (tmp == 0)
      return x.tid - y.tid;
    return tmp;
  };

  /**
   * The TimelineProcess represents a single process in the
   * trace. Right now, we keep this around purely for bookkeeping
   * reasons.
   * @constructor
   */
  function TimelineProcess(pid) {
    this.pid = pid;
    this.threads = {};
    this.counters = {};
  };

  TimelineProcess.prototype = {
    get numThreads() {
      var n = 0;
      for (var p in this.threads) {
        n++;
      }
      return n;
    },

    /**
     * @return {TimlineThread} The thread identified by tid on this process,
     * creating it if it doesn't exist.
     */
    getOrCreateThread: function(tid) {
      if (!this.threads[tid])
        this.threads[tid] = new TimelineThread(this, tid);
      return this.threads[tid];
    },

    /**
     * @return {TimlineCounter} The counter on this process named 'name',
     * creating it if it doesn't exist.
     */
    getOrCreateCounter: function(cat, name) {
      var id = cat + '.' + name;
      if (!this.counters[id])
        this.counters[id] = new TimelineCounter(this, id, name);
      return this.counters[id];
    }
  };

  /**
   * Comparison between processes that orders by pid.
   */
  TimelineProcess.compare = function(x, y) {
    return x.pid - y.pid;
  };

  /**
   * The TimelineCpu represents a Cpu from the kernel's point of view.
   * @constructor
   */
  function TimelineCpu(number) {
    this.cpuNumber = number;
    this.slices = [];
    this.counters = {};
  };

  TimelineCpu.prototype = {
    /**
     * @return {TimlineCounter} The counter on this process named 'name',
     * creating it if it doesn't exist.
     */
    getOrCreateCounter: function(cat, name) {
      var id;
      if (cat.length)
        id = cat + '.' + name;
      else
        id = name;
      if (!this.counters[id])
        this.counters[id] = new TimelineCounter(this, id, name);
      return this.counters[id];
    },

    /**
     * Updates the minTimestamp and maxTimestamp fields based on the
     * current slices attached to the cpu.
     */
    updateBounds: function() {
      var values = [];
      if (this.slices.length) {
        this.minTimestamp = this.slices[0].start;
        this.maxTimestamp = this.slices[this.slices.length - 1].end;
      } else {
        this.minTimestamp = undefined;
        this.maxTimestamp = undefined;
      }
    }
  };

  /**
   * Comparison between processes that orders by cpuNumber.
   */
  TimelineCpu.compare = function(x, y) {
    return x.cpuNumber - y.cpuNumber;
  };

  // The color pallette is split in half, with the upper
  // half of the pallette being the "highlighted" verison
  // of the base color. So, color 7's highlighted form is
  // 7 + (pallette.length / 2).
  //
  // These bright versions of colors are automatically generated
  // from the base colors.
  //
  // Within the color pallette, there are "regular" colors,
  // which can be used for random color selection, and
  // reserved colors, which are used when specific colors
  // need to be used, e.g. where red is desired.
  const palletteBase = [
    {r: 138, g: 113, b: 152},
    {r: 175, g: 112, b: 133},
    {r: 127, g: 135, b: 225},
    {r: 93, g: 81, b: 137},
    {r: 116, g: 143, b: 119},
    {r: 178, g: 214, b: 122},
    {r: 87, g: 109, b: 147},
    {r: 119, g: 155, b: 95},
    {r: 114, g: 180, b: 160},
    {r: 132, g: 85, b: 103},
    {r: 157, g: 210, b: 150},
    {r: 148, g: 94, b: 86},
    {r: 164, g: 108, b: 138},
    {r: 139, g: 191, b: 150},
    {r: 110, g: 99, b: 145},
    {r: 80, g: 129, b: 109},
    {r: 125, g: 140, b: 149},
    {r: 93, g: 124, b: 132},
    {r: 140, g: 85, b: 140},
    {r: 104, g: 163, b: 162},
    {r: 132, g: 141, b: 178},
    {r: 131, g: 105, b: 147},
    {r: 135, g: 183, b: 98},
    {r: 152, g: 134, b: 177},
    {r: 141, g: 188, b: 141},
    {r: 133, g: 160, b: 210},
    {r: 126, g: 186, b: 148},
    {r: 112, g: 198, b: 205},
    {r: 180, g: 122, b: 195},
    {r: 203, g: 144, b: 152},
    // Reserved Entires
    {r: 182, g: 125, b: 143},
    {r: 126, g: 200, b: 148},
    {r: 133, g: 160, b: 210},
    {r: 240, g: 240, b: 240}];

  // Make sure this number tracks the number of reserved entries in the
  // pallette.
  const numReservedColorIds = 4;

  function brighten(c) {
    var k;
    if (c.r >= 240 && c.g >= 240 && c.b >= 240)
      k = -0.20;
    else
      k = 0.45;

    return {r: Math.min(255, c.r + Math.floor(c.r * k)),
      g: Math.min(255, c.g + Math.floor(c.g * k)),
      b: Math.min(255, c.b + Math.floor(c.b * k))};
  }
  function colorToString(c) {
    return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
  }

  /**
   * The number of color IDs that getStringColorId can choose from.
   */
  const numRegularColorIds = palletteBase.length - numReservedColorIds;
  const highlightIdBoost = palletteBase.length;

  const pallette = palletteBase.concat(palletteBase.map(brighten)).
      map(colorToString);
  /**
   * Computes a simplistic hashcode of the provide name. Used to chose colors
   * for slices.
   * @param {string} name The string to hash.
   */
  function getStringHash(name) {
    var hash = 0;
    for (var i = 0; i < name.length; ++i)
      hash = (hash + 37 * hash + 11 * name.charCodeAt(i)) % 0xFFFFFFFF;
    return hash;
  }

  /**
   * Gets the color pallette.
   */
  function getPallette() {
    return pallette;
  }

  /**
   * @return {Number} The value to add to a color ID to get its highlighted
   * colro ID. E.g. 7 + getPalletteHighlightIdBoost() yields a brightened from
   * of 7's base color.
   */
  function getPalletteHighlightIdBoost() {
    return highlightIdBoost;
  }

  /**
   * @param {String} name The color name.
   * @return {Number} The color ID for the given color name.
   */
  function getColorIdByName(name) {
    if (name == 'iowait')
      return numRegularColorIds;
    if (name == 'running')
      return numRegularColorIds + 1;
    if (name == 'runnable')
      return numRegularColorIds + 2;
    if (name == 'sleeping')
      return numRegularColorIds + 3;
    throw 'Unrecognized color ' + name;
  }

  // Previously computed string color IDs. They are based on a stable hash, so
  // it is safe to save them throughout the program time.
  var stringColorIdCache = {};

  /**
   * @return {Number} A color ID that is stably associated to the provided via
   * the getStringHash method. The color ID will be chosen from the regular
   * ID space only, e.g. no reserved ID will be used.
   */
  function getStringColorId(string) {
    if (stringColorIdCache[string] === undefined) {
      var hash = getStringHash(string);
      stringColorIdCache[string] = hash % numRegularColorIds;
    }
    return stringColorIdCache[string];
  }

  /**
   * Builds a model from an array of TraceEvent objects.
   * @param {Object=} opt_data The event data to import into the new model.
   *     See TimelineModel.importEvents for details and more advanced ways to
   *     import data.
   * @param {bool=} opt_zeroAndBoost Whether to align to zero and boost the
   *     by 15%. Defaults to true.
   * @constructor
   */
  function TimelineModel(opt_eventData, opt_zeroAndBoost) {
    this.cpus = {};
    this.processes = {};
    this.importErrors = [];

    if (opt_eventData)
      this.importEvents(opt_eventData, opt_zeroAndBoost);
  }

  var importerConstructors = [];

  /**
   * Registers an importer. All registered importers are considered
   * when processing an import request.
   *
   * @param {Function} importerConstructor The importer's constructor function.
   */
  TimelineModel.registerImporter = function(importerConstructor) {
    importerConstructors.push(importerConstructor);
  }

  TimelineModel.prototype = {
    __proto__: cr.EventTarget.prototype,

    get numProcesses() {
      var n = 0;
      for (var p in this.processes)
        n++;
      return n;
    },

    /**
     * @return {TimelineProcess} Gets a specific TimelineCpu or creates one if
     * it does not exist.
     */
    getOrCreateCpu: function(cpuNumber) {
      if (!this.cpus[cpuNumber])
        this.cpus[cpuNumber] = new TimelineCpu(cpuNumber);
      return this.cpus[cpuNumber];
    },

    /**
     * @return {TimelineProcess} Gets a TimlineProcess for a specified pid or
     * creates one if it does not exist.
     */
    getOrCreateProcess: function(pid) {
      if (!this.processes[pid])
        this.processes[pid] = new TimelineProcess(pid);
      return this.processes[pid];
    },

    /**
     * The import takes an array of json-ified TraceEvents and adds them into
     * the TimelineModel as processes, threads, and slices.
     */

    /**
     * Removes threads from the model that are fully empty.
     */
    pruneEmptyThreads: function() {
      for (var pid in this.processes) {
        var process = this.processes[pid];
        var prunedThreads = {};
        for (var tid in process.threads) {
          var thread = process.threads[tid];

          // Begin-events without matching end events leave a thread in a state
          // where the toplevel subrows are empty but child subrows have
          // entries. The autocloser will fix this up later. But, for the
          // purposes of pruning, such threads need to be treated as having
          // content.
          var hasNonEmptySubrow = false;
          for (var s = 0; s < thread.subRows.length; s++)
            hasNonEmptySubrow |= thread.subRows[s].length > 0;

          if (hasNonEmptySubrow || thread.nonNestedSubRows.legnth)
            prunedThreads[tid] = thread;
        }
        process.threads = prunedThreads;
      }
    },

    updateBounds: function() {
      var wmin = Infinity;
      var wmax = -wmin;
      var hasData = false;

      var threads = this.getAllThreads();
      for (var tI = 0; tI < threads.length; tI++) {
        var thread = threads[tI];
        thread.updateBounds();
        if (thread.minTimestamp != undefined &&
            thread.maxTimestamp != undefined) {
          wmin = Math.min(wmin, thread.minTimestamp);
          wmax = Math.max(wmax, thread.maxTimestamp);
          hasData = true;
        }
      }
      var counters = this.getAllCounters();
      for (var tI = 0; tI < counters.length; tI++) {
        var counter = counters[tI];
        counter.updateBounds();
        if (counter.minTimestamp != undefined &&
            counter.maxTimestamp != undefined) {
          hasData = true;
          wmin = Math.min(wmin, counter.minTimestamp);
          wmax = Math.max(wmax, counter.maxTimestamp);
        }
      }

      for (var cpuNumber in this.cpus) {
        var cpu = this.cpus[cpuNumber];
        cpu.updateBounds();
        if (cpu.minTimestamp != undefined &&
            cpu.maxTimestamp != undefined) {
          hasData = true;
          wmin = Math.min(wmin, cpu.minTimestamp);
          wmax = Math.max(wmax, cpu.maxTimestamp);
        }
      }

      if (hasData) {
        this.minTimestamp = wmin;
        this.maxTimestamp = wmax;
      } else {
        this.maxTimestamp = undefined;
        this.minTimestamp = undefined;
      }
    },

    shiftWorldToZero: function() {
      if (this.minTimestamp === undefined)
        return;
      var timeBase = this.minTimestamp;
      var threads = this.getAllThreads();
      for (var tI = 0; tI < threads.length; tI++) {
        var thread = threads[tI];
        var shiftSubRow = function(subRow) {
          for (var tS = 0; tS < subRow.length; tS++) {
            var slice = subRow[tS];
            slice.start = (slice.start - timeBase);
          }
        };

        if (thread.cpuSlices)
          shiftSubRow(thread.cpuSlices);

        for (var tSR = 0; tSR < thread.subRows.length; tSR++) {
          shiftSubRow(thread.subRows[tSR]);
        }
        for (var tSR = 0; tSR < thread.nonNestedSubRows.length; tSR++) {
          shiftSubRow(thread.nonNestedSubRows[tSR]);
        }
      }
      var counters = this.getAllCounters();
      for (var tI = 0; tI < counters.length; tI++) {
        var counter = counters[tI];
        for (var sI = 0; sI < counter.timestamps.length; sI++)
          counter.timestamps[sI] = (counter.timestamps[sI] - timeBase);
      }
      var cpus = this.getAllCpus();
      for (var tI = 0; tI < cpus.length; tI++) {
        var cpu = cpus[tI];
        for (var sI = 0; sI < cpu.slices.length; sI++)
          cpu.slices[sI].start = (cpu.slices[sI].start - timeBase);
      }
      this.updateBounds();
    },

    getAllThreads: function() {
      var threads = [];
      for (var pid in this.processes) {
        var process = this.processes[pid];
        for (var tid in process.threads) {
          threads.push(process.threads[tid]);
        }
      }
      return threads;
    },

    /**
     * @return {Array} An array of all cpus in the model.
     */
    getAllCpus: function() {
      var cpus = [];
      for (var cpu in this.cpus)
        cpus.push(this.cpus[cpu]);
      return cpus;
    },

    /**
     * @return {Array} An array of all processes in the model.
     */
    getAllProcesses: function() {
      var processes = [];
      for (var pid in this.processes)
        processes.push(this.processes[pid]);
      return processes;
    },

    /**
     * @return {Array} An array of all the counters in the model.
     */
    getAllCounters: function() {
      var counters = [];
      for (var pid in this.processes) {
        var process = this.processes[pid];
        for (var tid in process.counters) {
          counters.push(process.counters[tid]);
        }
      }
      for (var cpuNumber in this.cpus) {
        var cpu = this.cpus[cpuNumber];
        for (var counterName in cpu.counters)
          counters.push(cpu.counters[counterName]);
      }
      return counters;
    },

    /**
     * Imports the provided events into the model. The eventData type
     * is undefined and will be passed to all the timeline importers registered
     * via TimelineModel.registerImporter. The first importer that returns true
     * for canImport(events) will be used to import the events.
     *
     * @param {Object} events Events to import.
     * @param {boolean} isChildImport True the eventData being imported is an
     *     additional trace after the primary eventData.
     */
    importOneTrace_: function(eventData, isAdditionalImport) {
      var importerConstructor;
      for (var i = 0; i < importerConstructors.length; ++i) {
        if (importerConstructors[i].canImport(eventData)) {
          importerConstructor = importerConstructors[i];
          break;
        }
      }
      if (!importerConstructor)
        throw 'Could not find an importer for the provided eventData.';

      var importer = new importerConstructor(
          this, eventData, isAdditionalImport);
      importer.importEvents();
      this.pruneEmptyThreads();
    },

    /**
     * Imports the provided traces into the model. The eventData type
     * is undefined and will be passed to all the timeline importers registered
     * via TimelineModel.registerImporter. The first importer that returns true
     * for canImport(events) will be used to import the events.
     *
     * The primary trace is provided via the eventData variable. If multiple
     * traces are to be imported, specify the first one as events, and the
     * remainder in the opt_additionalEventData array.
     *
     * @param {Object} eventData Events to import.
     * @param {bool=} opt_zeroAndBoost Whether to align to zero and boost the
     *     by 15%. Defaults to true.
     * @param {Array=} opt_additionalEventData An array of eventData objects
     *     (e.g. array of arrays) to
     * import after importing the primary events.
     */
    importEvents: function(eventData,
                           opt_zeroAndBoost, opt_additionalEventData) {
      if (opt_zeroAndBoost === undefined)
        opt_zeroAndBoost = true;

      this.importOneTrace_(eventData, false);
      if (opt_additionalEventData) {
        for (var i = 0; i < opt_additionalEventData.length; ++i) {
          this.importOneTrace_(opt_additionalEventData[i], true);
        }
      }

      this.updateBounds();

      if (opt_zeroAndBoost)
        this.shiftWorldToZero();

      if (opt_zeroAndBoost &&
          this.minTimestamp !== undefined &&
          this.maxTimestamp !== undefined) {
        var boost = (this.maxTimestamp - this.minTimestamp) * 0.15;
        this.minTimestamp = this.minTimestamp - boost;
        this.maxTimestamp = this.maxTimestamp + boost;
      }
    }
  };

  return {
    getPallette: getPallette,
    getPalletteHighlightIdBoost: getPalletteHighlightIdBoost,
    getColorIdByName: getColorIdByName,
    getStringHash: getStringHash,
    getStringColorId: getStringColorId,

    TimelineSlice: TimelineSlice,
    TimelineThread: TimelineThread,
    TimelineCounter: TimelineCounter,
    TimelineProcess: TimelineProcess,
    TimelineCpu: TimelineCpu,
    TimelineModel: TimelineModel
  };
});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Imports text files in the Linux event trace format into the
 * timeline model. This format is output both by sched_trace and by Linux's perf
 * tool.
 *
 * This importer assumes the events arrive as a string. The unit tests provide
 * examples of the trace format.
 *
 * Linux scheduler traces use a definition for 'pid' that is different than
 * tracing uses. Whereas tracing uses pid to identify a specific process, a pid
 * in a linux trace refers to a specific thread within a process. Within this
 * file, we the definition used in Linux traces, as it improves the importing
 * code's readability.
 */
cr.define('tracing', function() {
  /**
   * Represents the scheduling state for a single thread.
   * @constructor
   */
  function CpuState(cpu) {
    this.cpu = cpu;
  }

  CpuState.prototype = {
    __proto__: Object.prototype,

    /**
     * Switches the active pid on this Cpu. If necessary, add a TimelineSlice
     * to the cpu representing the time spent on that Cpu since the last call to
     * switchRunningLinuxPid.
     */
    switchRunningLinuxPid: function(importer, prevState, ts, pid, comm, prio) {
      // Generate a slice if the last active pid was not the idle task
      if (this.lastActivePid !== undefined && this.lastActivePid != 0) {
        var duration = ts - this.lastActiveTs;
        var thread = importer.threadsByLinuxPid[this.lastActivePid];
        if (thread)
          name = thread.userFriendlyName;
        else
          name = this.lastActiveComm;

        var slice = new tracing.TimelineSlice(name,
                                              tracing.getStringColorId(name),
                                              this.lastActiveTs,
                                              {comm: this.lastActiveComm,
                                               tid: this.lastActivePid,
                                               prio: this.lastActivePrio,
                                               stateWhenDescheduled: prevState
                                              },
                                              duration);
        this.cpu.slices.push(slice);
      }

      this.lastActiveTs = ts;
      this.lastActivePid = pid;
      this.lastActiveComm = comm;
      this.lastActivePrio = prio;
    }
  };

  function ThreadState(tid) {
    this.openSlices = [];
  }

  /**
   * Imports linux perf events into a specified model.
   * @constructor
   */
  function LinuxPerfImporter(model, events, isAdditionalImport) {
    this.isAdditionalImport_ = isAdditionalImport;
    this.model_ = model;
    this.events_ = events;
    this.clockSyncRecords_ = [];
    this.cpuStates_ = {};
    this.kernelThreadStates_ = {};
    this.buildMapFromLinuxPidsToTimelineThreads();

    // To allow simple indexing of threads, we store all the threads by their
    // kernel KPID. The KPID is a unique key for a thread in the trace.
    this.threadStateByKPID_ = {};
  }

  TestExports = {};

  // Matches the generic trace record:
  //          <idle>-0     [001]  1.23: sched_switch
  var lineRE = /^\s*(.+?)\s+\[(\d+)\]\s*(\d+\.\d+):\s+(\S+):\s(.*)$/;
  TestExports.lineRE = lineRE;

  // Matches the sched_switch record
  var schedSwitchRE = new RegExp(
      'prev_comm=(.+) prev_pid=(\\d+) prev_prio=(\\d+) prev_state=(\\S) ==> ' +
      'next_comm=(.+) next_pid=(\\d+) next_prio=(\\d+)');
  TestExports.schedSwitchRE = schedSwitchRE;

  // Matches the sched_wakeup record
  var schedWakeupRE =
      /comm=(.+) pid=(\d+) prio=(\d+) success=(\d+) target_cpu=(\d+)/;
  TestExports.schedWakeupRE = schedWakeupRE;

  // Matches the trace_event_clock_sync record
  //  0: trace_event_clock_sync: parent_ts=19581477508
  var traceEventClockSyncRE = /trace_event_clock_sync: parent_ts=(\d+\.?\d*)/;
  TestExports.traceEventClockSyncRE = traceEventClockSyncRE;

  // Matches the workqueue_execute_start record
  //  workqueue_execute_start: work struct c7a8a89c: function MISRWrapper
  var workqueueExecuteStartRE = /work struct (.+): function (\S+)/;

  // Matches the workqueue_execute_start record
  //  workqueue_execute_end: work struct c7a8a89c
  var workqueueExecuteEndRE = /work struct (.+)/;

  /**
   * Guesses whether the provided events is a Linux perf string.
   * Looks for the magic string "# tracer" at the start of the file,
   * or the typical task-pid-cpu-timestamp-function sequence of a typical
   * trace's body.
   *
   * @return {boolean} True when events is a linux perf array.
   */
  LinuxPerfImporter.canImport = function(events) {
    if (!(typeof(events) === 'string' || events instanceof String))
      return false;

    if (/^# tracer:/.exec(events))
      return true;

    var m = /^(.+)\n/.exec(events);
    if (m)
      events = m[1];
    if (lineRE.exec(events))
      return true;

    return false;
  };

  LinuxPerfImporter.prototype = {
    __proto__: Object.prototype,

    /**
     * Precomputes a lookup table from linux pids back to existing
     * TimelineThreads. This is used during importing to add information to each
     * timeline thread about whether it was running, descheduled, sleeping, et
     * cetera.
     */
    buildMapFromLinuxPidsToTimelineThreads: function() {
      this.threadsByLinuxPid = {};
      this.model_.getAllThreads().forEach(
          function(thread) {
            this.threadsByLinuxPid[thread.tid] = thread;
          }.bind(this));
    },

    /**
     * @return {CpuState} A CpuState corresponding to the given cpuNumber.
     */
    getOrCreateCpuState: function(cpuNumber) {
      if (!this.cpuStates_[cpuNumber]) {
        var cpu = this.model_.getOrCreateCpu(cpuNumber);
        this.cpuStates_[cpuNumber] = new CpuState(cpu);
      }
      return this.cpuStates_[cpuNumber];
    },

    /**
     * @return {number} The pid extracted from the kernel thread name.
     */
    parsePid: function(kernelThreadName) {
        var pid = /.+-(\d+)/.exec(kernelThreadName)[1];
        pid = parseInt(pid);
        return pid;
    },

    /**
     * @return {number} The string portion of the thread extracted from the
     * kernel thread name.
     */
    parseThreadName: function(kernelThreadName) {
        return /(.+)-\d+/.exec(kernelThreadName)[1];
    },

    /**
     * @return {TimelinThread} A thread corresponding to the kernelThreadName
     */
    getOrCreateKernelThread: function(kernelThreadName) {
      if (!this.kernelThreadStates_[kernelThreadName]) {
        pid = this.parsePid(kernelThreadName);

        var thread = this.model_.getOrCreateProcess(pid).getOrCreateThread(pid);
        thread.name = kernelThreadName;
        this.kernelThreadStates_[kernelThreadName] = {
          pid: pid,
          thread: thread,
          openSlice: undefined,
          openSliceTS: undefined
        };
        this.threadsByLinuxPid[pid] = thread;
      }
      return this.kernelThreadStates_[kernelThreadName];
    },

    /**
     * Imports the data in this.events_ into model_.
     */
    importEvents: function() {
      this.importCpuData();
      if (!this.alignClocks())
        return;
      this.buildPerThreadCpuSlicesFromCpuState();
    },

    /**
     * Builds the cpuSlices array on each thread based on our knowledge of what
     * each Cpu is doing.  This is done only for TimelineThreads that are
     * already in the model, on the assumption that not having any traced data
     * on a thread means that it is not of interest to the user.
     */
    buildPerThreadCpuSlicesFromCpuState: function() {
      // Push the cpu slices to the threads that they run on.
      for (var cpuNumber in this.cpuStates_) {
        var cpuState = this.cpuStates_[cpuNumber];
        var cpu = cpuState.cpu;

        for (var i = 0; i < cpu.slices.length; i++) {
          var slice = cpu.slices[i];

          var thread = this.threadsByLinuxPid[slice.args.tid];
          if (!thread)
            continue;
          if (!thread.tempCpuSlices)
            thread.tempCpuSlices = [];

          // Because Chrome's Array.sort is not a stable sort, we need to keep
          // the slice index around to keep slices with identical start times in
          // the proper order when sorting them.
          slice.index = i;

          thread.tempCpuSlices.push(slice);
        }
      }

      // Create slices for when the thread is not running.
      var runningId = tracing.getColorIdByName('running');
      var runnableId = tracing.getColorIdByName('runnable');
      var sleepingId = tracing.getColorIdByName('sleeping');
      var ioWaitId = tracing.getColorIdByName('iowait');
      this.model_.getAllThreads().forEach(function(thread) {
        if (!thread.tempCpuSlices)
          return;
        var origSlices = thread.tempCpuSlices;
        delete thread.tempCpuSlices;

        origSlices.sort(function(x, y) {
          var delta = x.start - y.start;
          if (delta == 0) {
            // Break ties using the original slice ordering.
            return x.index - y.index;
          } else {
            return delta;
          }
        });

        // Walk the slice list and put slices between each original slice
        // to show when the thread isn't running
        var slices = [];
        if (origSlices.length) {
          var slice = origSlices[0];
          slices.push(new tracing.TimelineSlice('Running', runningId,
              slice.start, {}, slice.duration));
        }
        for (var i = 1; i < origSlices.length; i++) {
          var prevSlice = origSlices[i - 1];
          var nextSlice = origSlices[i];
          var midDuration = nextSlice.start - prevSlice.end;
          if (prevSlice.args.stateWhenDescheduled == 'S') {
            slices.push(new tracing.TimelineSlice('Sleeping', sleepingId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'R') {
            slices.push(new tracing.TimelineSlice('Runnable', runnableId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'D') {
            slices.push(new tracing.TimelineSlice('I/O Wait', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'T') {
            slices.push(new tracing.TimelineSlice('__TASK_STOPPED', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 't') {
            slices.push(new tracing.TimelineSlice('debug', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'Z') {
            slices.push(new tracing.TimelineSlice('Zombie', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'X') {
            slices.push(new tracing.TimelineSlice('Exit Dead', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'x') {
            slices.push(new tracing.TimelineSlice('Task Dead', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else if (prevSlice.args.stateWhenDescheduled == 'W') {
            slices.push(new tracing.TimelineSlice('WakeKill', ioWaitId,
                prevSlice.end, {}, midDuration));
          } else {
            throw 'Unrecognized state: ' + prevSlice.args.stateWhenDescheduled;
          }

          slices.push(new tracing.TimelineSlice('Running', runningId,
              nextSlice.start, {}, nextSlice.duration));
        }
        thread.cpuSlices = slices;
      });
    },

    /**
     * Walks the slices stored on this.cpuStates_ and adjusts their timestamps
     * based on any alignment metadata we discovered.
     */
    alignClocks: function() {
      if (this.clockSyncRecords_.length == 0) {
        // If this is an additional import, and no clock syncing records were
        // found, then abort the import. Otherwise, just skip clock alignment.
        if (!this.isAdditionalImport_)
          return;

        // Remove the newly imported CPU slices from the model.
        this.abortImport();
        return false;
      }

      // Shift all the slice times based on the sync record.
      var sync = this.clockSyncRecords_[0];
      var timeShift = sync.parentTS - sync.perfTS;
      for (var cpuNumber in this.cpuStates_) {
        var cpuState = this.cpuStates_[cpuNumber];
        var cpu = cpuState.cpu;

        for (var i = 0; i < cpu.slices.length; i++) {
          var slice = cpu.slices[i];
          slice.start = slice.start + timeShift;
          slice.duration = slice.duration;
        }

        for (var counterName in cpu.counters) {
          var counter = cpu.counters[counterName];
          for (var sI = 0; sI < counter.timestamps.length; sI++)
            counter.timestamps[sI] = (counter.timestamps[sI] + timeShift);
        }
      }
      for (var kernelThreadName in this.kernelThreadStates_) {
        var kthread = this.kernelThreadStates_[kernelThreadName];
        var thread = kthread.thread;
        for (var i = 0; i < thread.subRows[0].length; i++) {
          thread.subRows[0][i].start += timeShift;
        }
      }
      return true;
    },

    /**
     * Removes any data that has been added to the model because of an error
     * detected during the import.
     */
    abortImport: function() {
      if (this.pushedEventsToThreads)
        throw 'Cannot abort, have alrady pushedCpuDataToThreads.';

      for (var cpuNumber in this.cpuStates_)
        delete this.model_.cpus[cpuNumber];
      for (var kernelThreadName in this.kernelThreadStates_) {
        var kthread = this.kernelThreadStates_[kernelThreadName];
        var thread = kthread.thread;
        var process = thread.parent;
        delete process.threads[thread.tid];
        delete this.model_.processes[process.pid];
      }
      this.model_.importErrors.push(
          'Cannot import kernel trace without a clock sync.');
    },

    /**
     * Records the fact that a pid has become runnable. This data will
     * eventually get used to derive each thread's cpuSlices array.
     */
    markPidRunnable: function(ts, pid, comm, prio) {
      // TODO(nduca): implement this functionality.
    },

    /**
     * Helper to process a 'begin' event (e.g. initiate a slice).
     * @param {ThreadState} state Thread state (holds slices).
     * @param {string} name The trace event name.
     * @param {number} ts The trace event begin timestamp.
     */
    processBegin: function(state, tname, name, ts, pid, tid) {
      var colorId = tracing.getStringColorId(name);
      var slice = new tracing.TimelineSlice(name, colorId, ts, null);
      // XXX: Should these be removed from the slice before putting it into the
      // model?
      slice.pid = pid;
      slice.tid = tid;
      slice.threadName = tname;
      state.openSlices.push(slice);
    },

    /**
     * Helper to process an 'end' event (e.g. close a slice).
     * @param {ThreadState} state Thread state (holds slices).
     * @param {number} ts The trace event begin timestamp.
     */
    processEnd: function(state, ts) {
      if (state.openSlices.length == 0) {
        // Ignore E events that are unmatched.
        return;
      }
      var slice = state.openSlices.pop();
      slice.duration = ts - slice.start;

      // Store the slice on the correct subrow.
      var thread = this.model_.getOrCreateProcess(slice.pid).
          getOrCreateThread(slice.tid);
      if (!thread.name)
        thread.name = slice.threadName;
      this.threadsByLinuxPid[slice.tid] = thread;
      var subRowIndex = state.openSlices.length;
      thread.getSubrow(subRowIndex).push(slice);

      // Add the slice to the subSlices array of its parent.
      if (state.openSlices.length) {
        var parentSlice = state.openSlices[state.openSlices.length - 1];
        parentSlice.subSlices.push(slice);
      }
    },

    /**
     * Helper function that closes any open slices. This happens when a trace
     * ends before an 'E' phase event can get posted. When that happens, this
     * closes the slice at the highest timestamp we recorded and sets the
     * didNotFinish flag to true.
     */
    autoCloseOpenSlices: function() {
      // We need to know the model bounds in order to assign an end-time to
      // the open slices.
      this.model_.updateBounds();

      // The model's max value in the trace is wrong at this point if there are
      // un-closed events. To close those events, we need the true global max
      // value. To compute this, build a list of timestamps that weren't
      // included in the max calculation, then compute the real maximum based
      // on that.
      var openTimestamps = [];
      for (var kpid in this.threadStateByKPID_) {
        var state = this.threadStateByKPID_[kpid];
        for (var i = 0; i < state.openSlices.length; i++) {
          var slice = state.openSlices[i];
          openTimestamps.push(slice.start);
          for (var s = 0; s < slice.subSlices.length; s++) {
            var subSlice = slice.subSlices[s];
            openTimestamps.push(subSlice.start);
            if (subSlice.duration)
              openTimestamps.push(subSlice.end);
          }
        }
      }

      // Figure out the maximum value of model.maxTimestamp and
      // Math.max(openTimestamps). Made complicated by the fact that the model
      // timestamps might be undefined.
      var realMaxTimestamp;
      if (this.model_.maxTimestamp) {
        realMaxTimestamp = Math.max(this.model_.maxTimestamp,
                                    Math.max.apply(Math, openTimestamps));
      } else {
        realMaxTimestamp = Math.max.apply(Math, openTimestamps);
      }

      // Automatically close any slices are still open. These occur in a number
      // of reasonable situations, e.g. deadlock. This pass ensures the open
      // slices make it into the final model.
      for (var kpid in this.threadStateByKPID_) {
        var state = this.threadStateByKPID_[kpid];
        while (state.openSlices.length > 0) {
          var slice = state.openSlices.pop();
          slice.duration = realMaxTimestamp - slice.start;
          slice.didNotFinish = true;

          // Store the slice on the correct subrow.
          var thread = this.model_.getOrCreateProcess(slice.pid)
                           .getOrCreateThread(slice.tid);
          var subRowIndex = state.openSlices.length;
          thread.getSubrow(subRowIndex).push(slice);

          // Add the slice to the subSlices array of its parent.
          if (state.openSlices.length) {
            var parentSlice = state.openSlices[state.openSlices.length - 1];
            parentSlice.subSlices.push(slice);
          }
        }
      }
    },

    /**
     * Helper that creates and adds samples to a TimelineCounter object based on
     * 'C' phase events.
     */
    processCounter: function(name, ts, value, pid) {
      var ctr = this.model_.getOrCreateProcess(pid)
          .getOrCreateCounter('', name);

      // Initialize the counter's series fields if needed.
      //
      if (ctr.numSeries == 0) {
        ctr.seriesNames.push('state');
        ctr.seriesColors.push(
            tracing.getStringColorId(ctr.name + '.' + 'state'));
      }

      // Add the sample values.
      ctr.timestamps.push(ts);
      ctr.samples.push(value);
    },


    /**
     * Walks the this.events_ structure and creates TimelineCpu objects.
     */
    importCpuData: function() {
      this.lines_ = this.events_.split('\n');

      for (var lineNumber = 0; lineNumber < this.lines_.length; ++lineNumber) {
        var line = this.lines_[lineNumber];
        if (/^#/.exec(line) || line.length == 0)
          continue;
        var eventBase = lineRE.exec(line);
        if (!eventBase) {
          this.model_.importErrors.push('Line ' + (lineNumber + 1) +
              ': Unrecognized line: ' + line);
          continue;
        }

        var cpuState = this.getOrCreateCpuState(parseInt(eventBase[2]));
        var ts = parseFloat(eventBase[3]) * 1000;

        var eventName = eventBase[4];

        if (eventName == 'sched_switch') {
          var event = schedSwitchRE.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed sched_switch event');
            continue;
          }

          var prevState = event[4];
          var nextComm = event[5];
          var nextPid = parseInt(event[6]);
          var nextPrio = parseInt(event[7]);
          cpuState.switchRunningLinuxPid(
              this, prevState, ts, nextPid, nextComm, nextPrio);

        } else if (eventName == 'sched_wakeup') {
          var event = schedWakeupRE.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed sched_wakeup event');
            continue;
          }

          var comm = event[1];
          var pid = parseInt(event[2]);
          var prio = parseInt(event[3]);
          this.markPidRunnable(ts, pid, comm, prio);

        } else if (eventName == 'cpu_frequency') {
          var event = /state=(\d+) cpu_id=(\d+)/.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed cpu_frequency event');
            continue;
          }
          var targetCpuNumber = parseInt(event[2]);
          var targetCpu = this.getOrCreateCpuState(targetCpuNumber);
          var freqCounter =
              targetCpu.cpu.getOrCreateCounter('', 'Frequency');
          if (freqCounter.numSeries == 0) {
            freqCounter.seriesNames.push('state');
            freqCounter.seriesColors.push(
                tracing.getStringColorId(freqCounter.name + '.' + 'state'));
          }
          var freqState = parseInt(event[1]);
          freqCounter.timestamps.push(ts);
          freqCounter.samples.push(freqState);
        } else if (eventName == 'cpufreq_interactive_already' ||
                   eventName == 'cpufreq_interactive_target') {
          var event = /cpu=(\d+) load=(\d+) cur=(\d+) targ=(\d+)/.
              exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed cpufreq_interactive_* event');
            continue;
          }
          var targetCpuNumber = parseInt(event[1]);
          var targetCpu = this.getOrCreateCpuState(targetCpuNumber);
          var loadCounter =
              targetCpu.cpu.getOrCreateCounter('', 'Load');
          if (loadCounter.numSeries == 0) {
            loadCounter.seriesNames.push('state');
            loadCounter.seriesColors.push(
                tracing.getStringColorId(loadCounter.name + '.' + 'state'));
          }
          var loadState = parseInt(event[2]);
          loadCounter.timestamps.push(ts);
          loadCounter.samples.push(loadState);
          loadCounter.maxTotal = 100;
          loadCounter.skipUpdateBounds = true;
        } else if (eventName == 'workqueue_execute_start') {
          var event = workqueueExecuteStartRE.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed workqueue_execute_start event');
            continue;
          }
          var kthread = this.getOrCreateKernelThread(eventBase[1]);
          kthread.openSliceTS = ts;
          kthread.openSlice = event[2];

        } else if (eventName == 'workqueue_execute_end') {
          var event = workqueueExecuteEndRE.exec(eventBase[5]);
          if (!event) {
            this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                ': Malformed workqueue_execute_start event');
            continue;
          }
          var kthread = this.getOrCreateKernelThread(eventBase[1]);
          if (kthread.openSlice) {
            var slice = new tracing.TimelineSlice(kthread.openSlice,
                tracing.getStringColorId(kthread.openSlice),
                kthread.openSliceTS,
                {},
                ts - kthread.openSliceTS);

            kthread.thread.subRows[0].push(slice);
          }
          kthread.openSlice = undefined;

        } else if (eventName == '0') { // trace_mark's show up with 0 prefixes.
          var event = traceEventClockSyncRE.exec(eventBase[5]);
          if (event)
            this.clockSyncRecords_.push({
              perfTS: ts,
              parentTS: event[1] * 1000
            });
          else {
            var tid = this.parsePid(eventBase[1]);
            var tname = this.parseThreadName(eventBase[1]);
            var kpid = tid;

            if (!(kpid in this.threadStateByKPID_))
              this.threadStateByKPID_[kpid] = new ThreadState();
            var state = this.threadStateByKPID_[kpid];

            var event = eventBase[5].split('|')
            switch (event[0]) {
            case 'B':
              var pid = parseInt(event[1]);
              var name = event[2];
              this.processBegin(state, tname, name, ts, pid, tid);
              break;
            case 'E':
              this.processEnd(state, ts);
              break;
            case 'C':
              var pid = parseInt(event[1]);
              var name = event[2];
              var value = parseInt(event[3]);
              this.processCounter(name, ts, value, pid);
              break;
            default:
              this.model_.importErrors.push('Line ' + (lineNumber + 1) +
                  ': Unrecognized event: ' + eventBase[5]);
            }
          }
        }
      }

      // Autoclose any open slices.
      var hasOpenSlices = false;
      for (var kpid in this.threadStateByKPID_) {
        var state = this.threadStateByKPID_[kpid];
        hasOpenSlices |= state.openSlices.length > 0;
      }
      if (hasOpenSlices)
        this.autoCloseOpenSlices();
    }
  };

  tracing.TimelineModel.registerImporter(LinuxPerfImporter);

  return {
    LinuxPerfImporter: LinuxPerfImporter,
    _LinuxPerfImporterTestExports: TestExports
  };

});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview TraceEventImporter imports TraceEvent-formatted data
 * into the provided timeline model.
 */
cr.define('tracing', function() {
  function ThreadState(tid) {
    this.openSlices = [];
    this.openNonNestedSlices = {};
  }

  function TraceEventImporter(model, eventData) {
    this.model_ = model;

    if (typeof(eventData) === 'string' || eventData instanceof String) {
      // If the event data begins with a [, then we know it should end with a ].
      // The reason we check for this is because some tracing implementations
      // cannot guarantee that a ']' gets written to the trace file. So, we are
      // forgiving and if this is obviously the case, we fix it up before
      // throwing the string at JSON.parse.
      if (eventData[0] == '[') {
        n = eventData.length;
        if (eventData[n - 1] != ']' && eventData[n - 1] != '\n') {
          eventData = eventData + ']';
        } else if (eventData[n - 2] != ']' && eventData[n - 1] == '\n') {
          eventData = eventData + ']';
        } else if (eventData[n - 3] != ']' && eventData[n - 2] == '\r' &&
            eventData[n - 1] == '\n') {
          eventData = eventData + ']';
        }
      }
      this.events_ = JSON.parse(eventData);

    } else {
      this.events_ = eventData;
    }

    // Some trace_event implementations put the actual trace events
    // inside a container. E.g { ... , traceEvents: [ ] }
    //
    // If we see that, just pull out the trace events.
    if (this.events_.traceEvents)
      this.events_ = this.events_.traceEvents;

    // To allow simple indexing of threads, we store all the threads by a
    // PTID. A ptid is a pid and tid joined together x:y fashion, eg
    // 1024:130. The ptid is a unique key for a thread in the trace.
    this.threadStateByPTID_ = {};
  }

  /**
   * @return {boolean} Whether obj is a TraceEvent array.
   */
  TraceEventImporter.canImport = function(eventData) {
    // May be encoded JSON. But we dont want to parse it fully yet.
    // Use a simple heuristic:
    //   - eventData that starts with [ are probably trace_event
    //   - eventData that starts with { are probably trace_event
    // May be encoded JSON. Treat files that start with { as importable by us.
    if (typeof(eventData) === 'string' || eventData instanceof String) {
      return eventData[0] == '{' || eventData[0] == '[';
    }

    // Might just be an array of events
    if (eventData instanceof Array && eventData[0].ph)
      return true;

    // Might be an object with a traceEvents field in it.
    if (eventData.traceEvents)
      return eventData.traceEvents instanceof Array &&
          eventData.traceEvents[0].ph;

    return false;
  };

  TraceEventImporter.prototype = {

    __proto__: Object.prototype,

    /**
     * Helper to process a 'begin' event (e.g. initiate a slice).
     * @param {ThreadState} state Thread state (holds slices).
     * @param {Object} event The current trace event.
     */
    processBegin: function(index, state, event) {
      var colorId = tracing.getStringColorId(event.name);
      var slice =
          { index: index,
            slice: new tracing.TimelineSlice(event.name, colorId,
                                             event.ts / 1000,
                                             event.args) };

      if (event.uts)
        slice.slice.startInUserTime = event.uts / 1000;

      if (event.args['ui-nest'] === '0') {
        var sliceID = event.name;
        for (var x in event.args)
          sliceID += ';' + event.args[x];
        if (state.openNonNestedSlices[sliceID])
          this.model_.importErrors.push('Event ' + sliceID + ' already open.');
        state.openNonNestedSlices[sliceID] = slice;
      } else {
        state.openSlices.push(slice);
      }
    },

    /**
     * Helper to process an 'end' event (e.g. close a slice).
     * @param {ThreadState} state Thread state (holds slices).
     * @param {Object} event The current trace event.
     */
    processEnd: function(state, event) {
      if (event.args['ui-nest'] === '0') {
        var sliceID = event.name;
        for (var x in event.args)
          sliceID += ';' + event.args[x];
        var slice = state.openNonNestedSlices[sliceID];
        if (!slice)
          return;
        slice.slice.duration = (event.ts / 1000) - slice.slice.start;
        if (event.uts)
          slice.durationInUserTime = (event.uts / 1000) -
              slice.slice.startInUserTime;

        // Store the slice in a non-nested subrow.
        var thread =
            this.model_.getOrCreateProcess(event.pid).
                getOrCreateThread(event.tid);
        thread.addNonNestedSlice(slice.slice);
        delete state.openNonNestedSlices[name];
      } else {
        if (state.openSlices.length == 0) {
          // Ignore E events that are unmatched.
          return;
        }
        var slice = state.openSlices.pop().slice;
        slice.duration = (event.ts / 1000) - slice.start;
        if (event.uts)
          slice.durationInUserTime = (event.uts / 1000) - slice.startInUserTime;

        // Store the slice on the correct subrow.
        var thread = this.model_.getOrCreateProcess(event.pid).
            getOrCreateThread(event.tid);
        var subRowIndex = state.openSlices.length;
        thread.getSubrow(subRowIndex).push(slice);

        // Add the slice to the subSlices array of its parent.
        if (state.openSlices.length) {
          var parentSlice = state.openSlices[state.openSlices.length - 1];
          parentSlice.slice.subSlices.push(slice);
        }
      }
    },

    /**
     * Helper function that closes any open slices. This happens when a trace
     * ends before an 'E' phase event can get posted. When that happens, this
     * closes the slice at the highest timestamp we recorded and sets the
     * didNotFinish flag to true.
     */
    autoCloseOpenSlices: function() {
      // We need to know the model bounds in order to assign an end-time to
      // the open slices.
      this.model_.updateBounds();

      // The model's max value in the trace is wrong at this point if there are
      // un-closed events. To close those events, we need the true global max
      // value. To compute this, build a list of timestamps that weren't
      // included in the max calculation, then compute the real maximum based
      // on that.
      var openTimestamps = [];
      for (var ptid in this.threadStateByPTID_) {
        var state = this.threadStateByPTID_[ptid];
        for (var i = 0; i < state.openSlices.length; i++) {
          var slice = state.openSlices[i];
          openTimestamps.push(slice.slice.start);
          for (var s = 0; s < slice.slice.subSlices.length; s++) {
            var subSlice = slice.slice.subSlices[s];
            openTimestamps.push(subSlice.start);
            if (subSlice.duration)
              openTimestamps.push(subSlice.end);
          }
        }
      }

      // Figure out the maximum value of model.maxTimestamp and
      // Math.max(openTimestamps). Made complicated by the fact that the model
      // timestamps might be undefined.
      var realMaxTimestamp;
      if (this.model_.maxTimestamp) {
        realMaxTimestamp = Math.max(this.model_.maxTimestamp,
                                    Math.max.apply(Math, openTimestamps));
      } else {
        realMaxTimestamp = Math.max.apply(Math, openTimestamps);
      }

      // Automatically close any slices are still open. These occur in a number
      // of reasonable situations, e.g. deadlock. This pass ensures the open
      // slices make it into the final model.
      for (var ptid in this.threadStateByPTID_) {
        var state = this.threadStateByPTID_[ptid];
        while (state.openSlices.length > 0) {
          var slice = state.openSlices.pop();
          slice.slice.duration = realMaxTimestamp - slice.slice.start;
          slice.slice.didNotFinish = true;
          var event = this.events_[slice.index];

          // Store the slice on the correct subrow.
          var thread = this.model_.getOrCreateProcess(event.pid)
                           .getOrCreateThread(event.tid);
          var subRowIndex = state.openSlices.length;
          thread.getSubrow(subRowIndex).push(slice.slice);

          // Add the slice to the subSlices array of its parent.
          if (state.openSlices.length) {
            var parentSlice = state.openSlices[state.openSlices.length - 1];
            parentSlice.slice.subSlices.push(slice.slice);
          }
        }
      }
    },

    /**
     * Helper that creates and adds samples to a TimelineCounter object based on
     * 'C' phase events.
     */
    processCounter: function(event) {
      var ctr_name;
      if (event.id !== undefined)
        ctr_name = event.name + '[' + event.id + ']';
      else
        ctr_name = event.name;

      var ctr = this.model_.getOrCreateProcess(event.pid)
          .getOrCreateCounter(event.cat, ctr_name);
      // Initialize the counter's series fields if needed.
      if (ctr.numSeries == 0) {
        for (var seriesName in event.args) {
          ctr.seriesNames.push(seriesName);
          ctr.seriesColors.push(
              tracing.getStringColorId(ctr.name + '.' + seriesName));
        }
        if (ctr.numSeries == 0) {
          this.model_.importErrors.push('Expected counter ' + event.name +
              ' to have at least one argument to use as a value.');
          // Drop the counter.
          delete ctr.parent.counters[ctr.name];
          return;
        }
      }

      // Add the sample values.
      ctr.timestamps.push(event.ts / 1000);
      for (var i = 0; i < ctr.numSeries; i++) {
        var seriesName = ctr.seriesNames[i];
        if (event.args[seriesName] === undefined) {
          ctr.samples.push(0);
          continue;
        }
        ctr.samples.push(event.args[seriesName]);
      }
    },

    /**
     * Walks through the events_ list and outputs the structures discovered to
     * model_.
     */
    importEvents: function() {
      // Walk through events
      var events = this.events_;
      for (var eI = 0; eI < events.length; eI++) {
        var event = events[eI];
        var ptid = event.pid + ':' + event.tid;

        if (!(ptid in this.threadStateByPTID_))
          this.threadStateByPTID_[ptid] = new ThreadState();
        var state = this.threadStateByPTID_[ptid];

        if (event.ph == 'B') {
          this.processBegin(eI, state, event);
        } else if (event.ph == 'E') {
          this.processEnd(state, event);
        } else if (event.ph == 'I') {
          // Treat an Instant event as a duration 0 slice.
          // TimelineSliceTrack's redraw() knows how to handle this.
          this.processBegin(eI, state, event);
          this.processEnd(state, event);
        } else if (event.ph == 'C') {
          this.processCounter(event);
        } else if (event.ph == 'M') {
          if (event.name == 'thread_name') {
            var thread = this.model_.getOrCreateProcess(event.pid)
                             .getOrCreateThread(event.tid);
            thread.name = event.args.name;
          } else {
            this.model_.importErrors.push(
                'Unrecognized metadata name: ' + event.name);
          }
        } else {
          this.model_.importErrors.push(
              'Unrecognized event phase: ' + event.ph +
              '(' + event.name + ')');
        }
      }

      // Autoclose any open slices.
      var hasOpenSlices = false;
      for (var ptid in this.threadStateByPTID_) {
        var state = this.threadStateByPTID_[ptid];
        hasOpenSlices |= state.openSlices.length > 0;
      }
      if (hasOpenSlices)
        this.autoCloseOpenSlices();
    }
  };

  tracing.TimelineModel.registerImporter(TraceEventImporter);

  return {
    TraceEventImporter: TraceEventImporter
  };
});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.


/**
 * @fileoverview Helper functions for doing intersections and iteration
 * over sorted arrays and intervals.
 *
 */
cr.define('tracing', function() {
  /**
   * Finds the first index in the array whose value is >= loVal.
   *
   * The key for the search is defined by the mapFn. This array must
   * be prearranged such that ary.map(mapFn) would also be sorted in
   * ascending order.
   *
   * @param {Array} ary An array of arbitrary objects.
   * @param {function():*} mapFn Callback that produces a key value
   *     from an element in ary.
   * @param {number} loVal Value for which to search.
   * @return {Number} Offset o into ary where all ary[i] for i <= o
   *     are < loVal, or ary.length if loVal is greater than all elements in
   *     the array.
   */
  function findLowIndexInSortedArray(ary, mapFn, loVal) {
    if (ary.length == 0)
      return 1;

    var low = 0;
    var high = ary.length - 1;
    var i, comparison;
    var hitPos = -1;
    while (low <= high) {
      i = Math.floor((low + high) / 2);
      comparison = mapFn(ary[i]) - loVal;
      if (comparison < 0) {
        low = i + 1; continue;
      } else if (comparison > 0) {
        high = i - 1; continue;
      } else {
        hitPos = i;
        high = i - 1;
      }
    }
    // return where we hit, or failing that the low pos
    return hitPos != -1 ? hitPos : low;
  }

  /**
   * Finds an index in an array of intervals that either
   * intersects the provided loVal, or if no intersection is found,
   * the index of the first interval whose start is > loVal.
   *
   * The array of intervals is defined implicitly via two mapping functions
   * over the provided ary. mapLoFn determines the lower value of the interval,
   * mapWidthFn the width. Intersection is lower-inclusive, e.g. [lo,lo+w).
   *
   * The array of intervals formed by this mapping must be non-overlapping and
   * sorted in ascending order by loVal.
   *
   * @param {Array} ary An array of objects that can be converted into sorted
   *     nonoverlapping ranges [x,y) using the mapLoFn and mapWidth.
   * @param {function():*} mapLoFn Callback that produces the low value for the
   *     interval represented by an  element in the array.
   * @param {function():*} mapLoFn Callback that produces the width for the
   *     interval represented by an  element in the array.
   * @param {number} loVal The low value for the search.
   * @return {Number} An index in the array that intersects or is first-above
   *     loVal, -1 if none found and loVal is below than all the intervals,
   *     ary.length if loVal is greater than all the intervals.
   */
  function findLowIndexInSortedIntervals(ary, mapLoFn, mapWidthFn, loVal) {
    var first = findLowIndexInSortedArray(ary, mapLoFn, loVal);
    if (first == 0) {
      if (loVal >= mapLoFn(ary[0]) &&
          loVal < mapLoFn(ary[0] + mapWidthFn(ary[0]))) {
        return 0;
      } else {
        return -1;
      }
    } else if (first <= ary.length &&
               loVal >= mapLoFn(ary[first - 1]) &&
               loVal < mapLoFn(ary[first - 1]) + mapWidthFn(ary[first - 1])) {
      return first - 1;
    } else {
      return ary.length;
    }
  }

  /**
   * Calls cb for all intervals in the implicit array of intervals
   * defnied by ary, mapLoFn and mapHiFn that intersect the range
   * [loVal,hiVal)
   *
   * This function uses the same scheme as findLowIndexInSortedArray
   * to define the intervals. The same restrictions on sortedness and
   * non-overlappingness apply.
   *
   * @param {Array} ary An array of objects that can be converted into sorted
   * nonoverlapping ranges [x,y) using the mapLoFn and mapWidth.
   * @param {function():*} mapLoFn Callback that produces the low value for the
   * interval represented by an element in the array.
   * @param {function():*} mapLoFn Callback that produces the width for the
   * interval represented by an element in the array.
   * @param {number} The low value for the search, inclusive.
   * @param {number} loVal The high value for the search, non inclusive.
   * @param {function():*} cb The function to run for intersecting intervals.
   */
  function iterateOverIntersectingIntervals(ary, mapLoFn, mapWidthFn, loVal,
                                            hiVal, cb) {
    if (loVal > hiVal) return;

    var i = findLowIndexInSortedArray(ary, mapLoFn, loVal);
    if (i == -1) {
      return;
    }
    if (i > 0) {
      var hi = mapLoFn(ary[i - 1]) + mapWidthFn(ary[i - 1]);
      if (hi >= loVal) {
        cb(ary[i - 1]);
      }
    }
    if (i == ary.length) {
      return;
    }

    for (var n = ary.length; i < n; i++) {
      var lo = mapLoFn(ary[i]);
      if (lo >= hiVal)
        break;
      cb(ary[i]);
    }
  }

  /**
   * Non iterative version of iterateOverIntersectingIntervals.
   *
   * @return {Array} Array of elements in ary that intersect loVal, hiVal.
   */
  function getIntersectingIntervals(ary, mapLoFn, mapWidthFn, loVal, hiVal) {
    var tmp = [];
    iterateOverIntersectingIntervals(ary, mapLoFn, mapWidthFn, loVal, hiVal,
                                     function(d) {
                                       tmp.push(d);
                                     });
    return tmp;
  }

  return {
    findLowIndexInSortedArray: findLowIndexInSortedArray,
    findLowIndexInSortedIntervals: findLowIndexInSortedIntervals,
    iterateOverIntersectingIntervals: iterateOverIntersectingIntervals,
    getIntersectingIntervals: getIntersectingIntervals
  };
});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

cr.define('tracing', function() {
  /**
   * Uses an embedded iframe to measure provided elements without forcing layout
   * on the main document.
   * @constructor
   * @extends {Object}
   */
  function MeasuringStick() {
    var iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);
    this._doc = iframe.contentDocument;
    this._window = iframe.contentWindow;
    this._doc.body.style.cssText = 'padding:0;margin:0;overflow:hidden';

    var stylesheets = document.querySelectorAll('link[rel=stylesheet]');
    for (var i = 0; i < stylesheets.length; i++) {
      var stylesheet = stylesheets[i];
      var link = this._doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = stylesheet.href;
      this._doc.head.appendChild(link);
    }
  }

  MeasuringStick.prototype = {
    __proto__: Object.prototype,

    /**
     * Measures the provided element without forcing layout on the main
     * document.
     */
    measure: function(element) {
      this._doc.body.appendChild(element);
      var style = this._window.getComputedStyle(element);
      var width = parseInt(style.width, 10);
      var height = parseInt(style.height, 10);
      this._doc.body.removeChild(element);
      return { width: width, height: height };
    }
  };

  return {
    MeasuringStick: MeasuringStick
  };
});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Interactive visualizaiton of TimelineModel objects
 * based loosely on gantt charts. Each thread in the TimelineModel is given a
 * set of TimelineTracks, one per subrow in the thread. The Timeline class
 * acts as a controller, creating the individual tracks, while TimelineTracks
 * do actual drawing.
 *
 * Visually, the Timeline produces (prettier) visualizations like the following:
 *    Thread1:  AAAAAAAAAA         AAAAA
 *                  BBBB              BB
 *    Thread2:     CCCCCC                 CCCCC
 *
 */
cr.define('tracing', function() {

  /**
   * The TimelineViewport manages the transform used for navigating
   * within the timeline. It is a simple transform:
   *   x' = (x+pan) * scale
   *
   * The timeline code tries to avoid directly accessing this transform,
   * instead using this class to do conversion between world and view space,
   * as well as the math for centering the viewport in various interesting
   * ways.
   *
   * @constructor
   * @extends {cr.EventTarget}
   */
  function TimelineViewport(parentEl) {
    this.parentEl_ = parentEl;
    this.scaleX_ = 1;
    this.panX_ = 0;
    this.gridTimebase_ = 0;
    this.gridStep_ = 1000 / 60;
    this.gridEnabled_ = false;
    this.hasCalledSetupFunction_ = false;

    this.onResizeBoundToThis_ = this.onResize_.bind(this);

    // The following code uses an interval to detect when the parent element
    // is attached to the document. That is a trigger to run the setup function
    // and install a resize listener.
    this.checkForAttachInterval_ = setInterval(
        this.checkForAttach_.bind(this), 250);
  }

  TimelineViewport.prototype = {
    __proto__: cr.EventTarget.prototype,

    /**
     * Allows initialization of the viewport when the viewport's parent element
     * has been attached to the document and given a size.
     * @param {Function} fn Function to call when the viewport can be safely
     * initialized.
     */
    setWhenPossible: function(fn) {
      this.pendingSetFunction_ = fn;
    },

    /**
     * @return {boolean} Whether the current timeline is attached to the
     * document.
     */
    get isAttachedToDocument_() {
      var cur = this.parentEl_;
      while (cur.parentNode)
        cur = cur.parentNode;
      return cur == this.parentEl_.ownerDocument;
    },

    onResize_: function() {
      this.dispatchChangeEvent();
    },

    /**
     * Checks whether the parentNode is attached to the document.
     * When it is, it installs the iframe-based resize detection hook
     * and then runs the pendingSetFunction_, if present.
     */
    checkForAttach_: function() {
      if (!this.isAttachedToDocument_ || this.clientWidth == 0)
        return;

      if (!this.iframe_) {
        this.iframe_ = document.createElement('iframe');
        this.iframe_.style.cssText =
            'position:absolute;width:100%;height:0;border:0;visibility:hidden;';
        this.parentEl_.appendChild(this.iframe_);

        this.iframe_.contentWindow.addEventListener('resize',
                                                    this.onResizeBoundToThis_);
      }

      var curSize = this.clientWidth + 'x' + this.clientHeight;
      if (this.pendingSetFunction_) {
        this.lastSize_ = curSize;
        this.pendingSetFunction_();
        this.pendingSetFunction_ = undefined;
      }

      window.clearInterval(this.checkForAttachInterval_);
      this.checkForAttachInterval_ = undefined;
    },

    /**
     * Fires the change event on this viewport. Used to notify listeners
     * to redraw when the underlying model has been mutated.
     */
    dispatchChangeEvent: function() {
      cr.dispatchSimpleEvent(this, 'change');
    },

    detach: function() {
      if (this.checkForAttachInterval_) {
        window.clearInterval(this.checkForAttachInterval_);
        this.checkForAttachInterval_ = undefined;
      }
      this.iframe_.removeEventListener('resize', this.onResizeBoundToThis_);
      this.parentEl_.removeChild(this.iframe_);
    },

    get scaleX() {
      return this.scaleX_;
    },
    set scaleX(s) {
      var changed = this.scaleX_ != s;
      if (changed) {
        this.scaleX_ = s;
        this.dispatchChangeEvent();
      }
    },

    get panX() {
      return this.panX_;
    },
    set panX(p) {
      var changed = this.panX_ != p;
      if (changed) {
        this.panX_ = p;
        this.dispatchChangeEvent();
      }
    },

    setPanAndScale: function(p, s) {
      var changed = this.scaleX_ != s || this.panX_ != p;
      if (changed) {
        this.scaleX_ = s;
        this.panX_ = p;
        this.dispatchChangeEvent();
      }
    },

    xWorldToView: function(x) {
      return (x + this.panX_) * this.scaleX_;
    },

    xWorldVectorToView: function(x) {
      return x * this.scaleX_;
    },

    xViewToWorld: function(x) {
      return (x / this.scaleX_) - this.panX_;
    },

    xViewVectorToWorld: function(x) {
      return x / this.scaleX_;
    },

    xPanWorldPosToViewPos: function(worldX, viewX, viewWidth) {
      if (typeof viewX == 'string') {
        if (viewX == 'left') {
          viewX = 0;
        } else if (viewX == 'center') {
          viewX = viewWidth / 2;
        } else if (viewX == 'right') {
          viewX = viewWidth - 1;
        } else {
          throw Error('unrecognized string for viewPos. left|center|right');
        }
      }
      this.panX = (viewX / this.scaleX_) - worldX;
    },

    get gridEnabled() {
      return this.gridEnabled_;
    },

    set gridEnabled(enabled) {
      if (this.gridEnabled_ == enabled)
        return;
      this.gridEnabled_ = enabled && true;
      this.dispatchChangeEvent();
    },

    get gridTimebase() {
      return this.gridTimebase_;
    },

    set gridTimebase(timebase) {
      if (this.gridTimebase_ == timebase)
        return;
      this.gridTimebase_ = timebase;
      cr.dispatchSimpleEvent(this, 'change');
    },

    get gridStep() {
      return this.gridStep_;
    },

    applyTransformToCanavs: function(ctx) {
      ctx.transform(this.scaleX_, 0, 0, 1, this.panX_ * this.scaleX_, 0);
    }
  };

  /**
   * Renders a TimelineModel into a div element, making one
   * TimelineTrack for each subrow in each thread of the model, managing
   * overall track layout, and handling user interaction with the
   * viewport.
   *
   * @constructor
   * @extends {HTMLDivElement}
   */
  Timeline = cr.ui.define('div');

  Timeline.prototype = {
    __proto__: HTMLDivElement.prototype,

    model_: null,

    decorate: function() {
      this.classList.add('timeline');

      this.viewport_ = new TimelineViewport(this);

      this.tracks_ = this.ownerDocument.createElement('div');
      this.appendChild(this.tracks_);

      this.dragBox_ = this.ownerDocument.createElement('div');
      this.dragBox_.className = 'timeline-drag-box';
      this.appendChild(this.dragBox_);
      this.hideDragBox_();

      this.bindEventListener_(document, 'keypress', this.onKeypress_, this);
      this.bindEventListener_(document, 'keydown', this.onKeydown_, this);
      this.bindEventListener_(document, 'mousedown', this.onMouseDown_, this);
      this.bindEventListener_(document, 'mousemove', this.onMouseMove_, this);
      this.bindEventListener_(document, 'mouseup', this.onMouseUp_, this);
      this.bindEventListener_(document, 'dblclick', this.onDblClick_, this);

      this.lastMouseViewPos_ = {x: 0, y: 0};

      this.selection_ = [];
    },

    /**
     * Wraps the standard addEventListener but automatically binds the provided
     * func to the provided target, tracking the resulting closure. When detach
     * is called, these listeners will be automatically removed.
     */
    bindEventListener_: function(object, event, func, target) {
      if (!this.boundListeners_)
        this.boundListeners_ = [];
      var boundFunc = func.bind(target);
      this.boundListeners_.push({object: object,
        event: event,
        boundFunc: boundFunc});
      object.addEventListener(event, boundFunc);
    },

    detach: function() {
      for (var i = 0; i < this.tracks_.children.length; i++)
        this.tracks_.children[i].detach();

      for (var i = 0; i < this.boundListeners_.length; i++) {
        var binding = this.boundListeners_[i];
        binding.object.removeEventListener(binding.event, binding.boundFunc);
      }
      this.boundListeners_ = undefined;
      this.viewport_.detach();
    },

    get viewport() {
      return this.viewport_;
    },

    get model() {
      return this.model_;
    },

    set model(model) {
      if (!model)
        throw Error('Model cannot be null');
      if (this.model) {
        throw Error('Cannot set model twice.');
      }
      this.model_ = model;

      // Figure out all the headings.
      var allHeadings = [];
      model.getAllThreads().forEach(function(t) {
        allHeadings.push(t.userFriendlyName);
      });
      model.getAllCounters().forEach(function(c) {
        allHeadings.push(c.name);
      });
      model.getAllCpus().forEach(function(c) {
        allHeadings.push('CPU ' + c.cpuNumber);
      });

      // Figure out the maximum heading size.
      var maxHeadingWidth = 0;
      var measuringStick = new tracing.MeasuringStick();
      var headingEl = document.createElement('div');
      headingEl.style.position = 'fixed';
      headingEl.className = 'timeline-canvas-based-track-title';
      allHeadings.forEach(function(text) {
        headingEl.textContent = text + ':__';
        var w = measuringStick.measure(headingEl).width;
        // Limit heading width to 300px.
        if (w > 300)
          w = 300;
        if (w > maxHeadingWidth)
          maxHeadingWidth = w;
      });
      maxHeadingWidth = maxHeadingWidth + 'px';

      // Reset old tracks.
      for (var i = 0; i < this.tracks_.children.length; i++)
        this.tracks_.children[i].detach();
      this.tracks_.textContent = '';

      // Get a sorted list of CPUs
      var cpus = model.getAllCpus();
      cpus.sort(tracing.TimelineCpu.compare);

      // Create tracks for each CPU.
      cpus.forEach(function(cpu) {
        var track = new tracing.TimelineCpuTrack();
        track.heading = 'CPU ' + cpu.cpuNumber + ':';
        track.headingWidth = maxHeadingWidth;
        track.viewport = this.viewport_;
        track.cpu = cpu;
        this.tracks_.appendChild(track);

        for (var counterName in cpu.counters) {
          var counter = cpu.counters[counterName];
          track = new tracing.TimelineCounterTrack();
          track.heading = 'CPU ' + cpu.cpuNumber + ' ' + counter.name + ':';
          track.headingWidth = maxHeadingWidth;
          track.viewport = this.viewport_;
          track.counter = counter;
          this.tracks_.appendChild(track);
        }
      }.bind(this));

      // Get a sorted list of processes.
      var processes = model.getAllProcesses();
      processes.sort(tracing.TimelineProcess.compare);

      // Create tracks for each process.
      processes.forEach(function(process) {
        // Add counter tracks for this process.
        var counters = [];
        for (var tid in process.counters)
          counters.push(process.counters[tid]);
        counters.sort(tracing.TimelineCounter.compare);

        // Create the counters for this process.
        counters.forEach(function(counter) {
          var track = new tracing.TimelineCounterTrack();
          track.heading = counter.name + ':';
          track.headingWidth = maxHeadingWidth;
          track.viewport = this.viewport_;
          track.counter = counter;
          this.tracks_.appendChild(track);
        }.bind(this));

        // Get a sorted list of threads.
        var threads = [];
        for (var tid in process.threads)
          threads.push(process.threads[tid]);
        threads.sort(tracing.TimelineThread.compare);

        // Create the threads.
        threads.forEach(function(thread) {
          var track = new tracing.TimelineThreadTrack();
          track.heading = thread.userFriendlyName + ':';
          track.tooltip = thread.userFriendlyDetials;
          track.headingWidth = maxHeadingWidth;
          track.viewport = this.viewport_;
          track.thread = thread;
          this.tracks_.appendChild(track);
        }.bind(this));
      }.bind(this));

      // Set up a reasonable viewport.
      this.viewport_.setWhenPossible(function() {
        var rangeTimestamp = this.model_.maxTimestamp -
            this.model_.minTimestamp;
        var w = this.firstCanvas.width;
        var scaleX = w / rangeTimestamp;
        var panX = -this.model_.minTimestamp;
        this.viewport_.setPanAndScale(panX, scaleX);
      }.bind(this));
    },

    /**
     * @return {Element} The element whose focused state determines
     * whether to respond to keyboard inputs.
     * Defaults to the parent element.
     */
    get focusElement() {
      if (this.focusElement_)
        return this.focusElement_;
      return this.parentElement;
    },

    /**
     * Sets the element whose focus state will determine whether
     * to respond to keybaord input.
     */
    set focusElement(value) {
      this.focusElement_ = value;
    },

    get listenToKeys_() {
      if (!this.focusElement_)
        return true;
      if (this.focusElement.tabIndex >= 0)
        return document.activeElement == this.focusElement;
      return true;
    },

    onKeypress_: function(e) {
      var vp = this.viewport_;
      if (!this.firstCanvas)
        return;
      if (!this.listenToKeys_)
        return;
      var viewWidth = this.firstCanvas.clientWidth;
      var curMouseV, curCenterW;
      switch (e.keyCode) {
        case 101: // e
          var vX = this.lastMouseViewPos_.x;
          var wX = vp.xViewToWorld(this.lastMouseViewPos_.x);
          var distFromCenter = vX - (viewWidth / 2);
          var percFromCenter = distFromCenter / viewWidth;
          var percFromCenterSq = percFromCenter * percFromCenter;
          vp.xPanWorldPosToViewPos(wX, 'center', viewWidth);
          break;
        case 119:  // w
          this.zoomBy_(1.5);
          break;
        case 115:  // s
          this.zoomBy_(1 / 1.5);
          break;
        case 103:  // g
          this.onGridToggle_(true);
          break;
        case 71:  // G
          this.onGridToggle_(false);
          break;
        case 87:  // W
          this.zoomBy_(10);
          break;
        case 83:  // S
          this.zoomBy_(1 / 10);
          break;
        case 97:  // a
          vp.panX += vp.xViewVectorToWorld(viewWidth * 0.1);
          break;
        case 100:  // d
          vp.panX -= vp.xViewVectorToWorld(viewWidth * 0.1);
          break;
        case 65:  // A
          vp.panX += vp.xViewVectorToWorld(viewWidth * 0.5);
          break;
        case 68:  // D
          vp.panX -= vp.xViewVectorToWorld(viewWidth * 0.5);
          break;
      }
    },

    // Not all keys send a keypress.
    onKeydown_: function(e) {
      if (!this.listenToKeys_)
        return;
      switch (e.keyCode) {
        case 37:   // left arrow
          this.selectPrevious_(e);
          e.preventDefault();
          break;
        case 39:   // right arrow
          this.selectNext_(e);
          e.preventDefault();
          break;
        case 9:    // TAB
          if (this.focusElement.tabIndex == -1) {
            if (e.shiftKey)
              this.selectPrevious_(e);
            else
              this.selectNext_(e);
            e.preventDefault();
          }
          break;
      }
    },

    /**
     * Zoom in or out on the timeline by the given scale factor.
     * @param {integer} scale The scale factor to apply.  If <1, zooms out.
     */
    zoomBy_: function(scale) {
      if (!this.firstCanvas)
        return;
      var vp = this.viewport_;
      var viewWidth = this.firstCanvas.clientWidth;
      var curMouseV = this.lastMouseViewPos_.x;
      var curCenterW = vp.xViewToWorld(curMouseV);
      vp.scaleX = vp.scaleX * scale;
      vp.xPanWorldPosToViewPos(curCenterW, curMouseV, viewWidth);
    },

    /** Select the next slice on the timeline.  Applies to each track. */
    selectNext_: function(e) {
      this.selectAdjoining_(e, true);
    },

    /** Select the previous slice on the timeline.  Applies to each track. */
    selectPrevious_: function(e) {
      this.selectAdjoining_(e, false);
    },

    /**
     * Helper for selection previous or next.
     * @param {Event} The current event.
     * @param {boolean} forwardp If true, select one forward (next).
     *   Else, select previous.
     */
    selectAdjoining_: function(e, forwardp) {
      var i, track, slice, adjoining;
      var selection = [];
      // Clear old selection; try and select next.
      for (i = 0; i < this.selection_.length; i++) {
        adjoining = undefined;
        this.selection_[i].slice.selected = false;
        track = this.selection_[i].track;
        slice = this.selection_[i].slice;
        if (slice) {
          if (forwardp)
            adjoining = track.pickNext(slice);
          else
            adjoining = track.pickPrevious(slice);
        }
        if (adjoining != undefined)
          selection.push({track: track, slice: adjoining});
      }
      this.selection = selection;
      e.preventDefault();
    },

    get keyHelp() {
      var help = 'Keyboard shortcuts:\n' +
          ' w/s     : Zoom in/out    (with shift: go faster)\n' +
          ' a/d     : Pan left/right\n' +
          ' e       : Center on mouse\n' +
          ' g/G     : Shows grid at the start/end of the selected task\n';

      if (this.focusElement.tabIndex) {
        help += ' <-      : Select previous event on current timeline\n' +
            ' ->      : Select next event on current timeline\n';
      } else {
        help += ' <-,^TAB : Select previous event on current timeline\n' +
            ' ->, TAB : Select next event on current timeline\n';
      }
      help +=
          '\n' +
          'Dbl-click to zoom in; Shift dbl-click to zoom out\n';
      return help;
    },

    get selection() {
      return this.selection_;
    },

    set selection(selection) {
      // Clear old selection.
      for (i = 0; i < this.selection_.length; i++)
        this.selection_[i].slice.selected = false;

      this.selection_ = selection;

      cr.dispatchSimpleEvent(this, 'selectionChange');
      for (i = 0; i < this.selection_.length; i++)
        this.selection_[i].slice.selected = true;
      this.viewport_.dispatchChangeEvent(); // Triggers a redraw.
    },

    get firstCanvas() {
      return this.tracks_.firstChild ?
          this.tracks_.firstChild.firstCanvas : undefined;
    },

    hideDragBox_: function() {
      this.dragBox_.style.left = '-1000px';
      this.dragBox_.style.top = '-1000px';
      this.dragBox_.style.width = 0;
      this.dragBox_.style.height = 0;
    },

    setDragBoxPosition_: function(eDown, eCur) {
      var loX = Math.min(eDown.clientX, eCur.clientX);
      var hiX = Math.max(eDown.clientX, eCur.clientX);
      var loY = Math.min(eDown.clientY, eCur.clientY);
      var hiY = Math.max(eDown.clientY, eCur.clientY);

      this.dragBox_.style.left = loX + 'px';
      this.dragBox_.style.top = loY + 'px';
      this.dragBox_.style.width = hiX - loX + 'px';
      this.dragBox_.style.height = hiY - loY + 'px';

      var canv = this.firstCanvas;
      var loWX = this.viewport_.xViewToWorld(loX - canv.offsetLeft);
      var hiWX = this.viewport_.xViewToWorld(hiX - canv.offsetLeft);

      var roundedDuration = Math.round((hiWX - loWX) * 100) / 100;
      this.dragBox_.textContent = roundedDuration + 'ms';

      var e = new cr.Event('selectionChanging');
      e.loWX = loWX;
      e.hiWX = hiWX;
      this.dispatchEvent(e);
    },

    onGridToggle_: function(left) {
      var tb;
      if (left)
        tb = Math.min.apply(Math, this.selection_.map(
            function(x) { return x.slice.start; }));
      else
        tb = Math.max.apply(Math, this.selection_.map(
            function(x) { return x.slice.end; }));

      // Shift the timebase left until its just left of minTimestamp.
      var numInterfvalsSinceStart = Math.ceil((tb - this.model_.minTimestamp) /
          this.viewport_.gridStep_);
      this.viewport_.gridTimebase = tb -
          (numInterfvalsSinceStart + 1) * this.viewport_.gridStep_;
      this.viewport_.gridEnabled = true;
    },

    onMouseDown_: function(e) {
      rect = this.tracks_.getClientRects()[0];
      var inside = rect &&
          e.clientX >= rect.left &&
          e.clientX < rect.right &&
          e.clientY >= rect.top &&
          e.clientY < rect.bottom;
      if (!inside)
        return;

      var canv = this.firstCanvas;
      var pos = {
        x: e.clientX - canv.offsetLeft,
        y: e.clientY - canv.offsetTop
      };

      var wX = this.viewport_.xViewToWorld(pos.x);

      this.dragBeginEvent_ = e;
      e.preventDefault();
      if (this.focusElement.tabIndex >= 0)
        this.focusElement.focus();
    },

    onMouseMove_: function(e) {
      if (!this.firstCanvas)
        return;
      var canv = this.firstCanvas;
      var pos = {
        x: e.clientX - canv.offsetLeft,
        y: e.clientY - canv.offsetTop
      };

      // Remember position. Used during keyboard zooming.
      this.lastMouseViewPos_ = pos;

      // Update the drag box
      if (this.dragBeginEvent_) {
        this.setDragBoxPosition_(this.dragBeginEvent_, e);
      }
    },

    onMouseUp_: function(e) {
      var i;
      if (this.dragBeginEvent_) {
        // Stop the dragging.
        this.hideDragBox_();
        var eDown = this.dragBeginEvent_;
        this.dragBeginEvent_ = null;

        // Figure out extents of the drag.
        var loX = Math.min(eDown.clientX, e.clientX);
        var hiX = Math.max(eDown.clientX, e.clientX);
        var loY = Math.min(eDown.clientY, e.clientY);
        var hiY = Math.max(eDown.clientY, e.clientY);

        // Convert to worldspace.
        var canv = this.firstCanvas;
        var loWX = this.viewport_.xViewToWorld(loX - canv.offsetLeft);
        var hiWX = this.viewport_.xViewToWorld(hiX - canv.offsetLeft);

        // Figure out what has been hit.
        var selection = [];
        function addHit(type, track, slice) {
          selection.push({track: track, slice: slice});
        }
        for (i = 0; i < this.tracks_.children.length; i++) {
          var track = this.tracks_.children[i];

          // Only check tracks that insersect the rect.
          var trackClientRect = track.getBoundingClientRect();
          var a = Math.max(loY, trackClientRect.top);
          var b = Math.min(hiY, trackClientRect.bottom);
          if (a <= b) {
            track.pickRange(loWX, hiWX, loY, hiY, addHit);
          }
        }
        // Activate the new selection.
        this.selection = selection;
      }
    },

    onDblClick_: function(e) {
      var scale = 4;
      if (e.shiftKey)
        scale = 1 / scale;
      this.zoomBy_(scale);
      e.preventDefault();
    }
  };

  /**
   * The TimelineModel being viewed by the timeline
   * @type {TimelineModel}
   */
  cr.defineProperty(Timeline, 'model', cr.PropertyKind.JS);

  return {
    Timeline: Timeline,
    TimelineViewport: TimelineViewport
  };
});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.


/**
 * @fileoverview Renders an array of slices into the provided div,
 * using a child canvas element. Uses a FastRectRenderer to draw only
 * the visible slices.
 */
cr.define('tracing', function() {

  var pallette = tracing.getPallette();
  var highlightIdBoost = tracing.getPalletteHighlightIdBoost();

  var textWidthMap = { };
  function quickMeasureText(ctx, text) {
    var w = textWidthMap[text];
    if (!w) {
      w = ctx.measureText(text).width;
      textWidthMap[text] = w;
    }
    return w;
  }

  /**
   * A generic track that contains other tracks as its children.
   * @constructor
   */
  var TimelineContainerTrack = cr.ui.define('div');
  TimelineContainerTrack.prototype = {
    __proto__: HTMLDivElement.prototype,

    decorate: function() {
      this.tracks_ = [];
    },

    detach: function() {
      for (var i = 0; i < this.tracks_.length; i++)
        this.tracks_[i].detach();
    },

    get viewport() {
      return this.viewport_;
    },

    set viewport(v) {
      this.viewport_ = v;
      for (var i = 0; i < this.tracks_.length; i++)
        this.tracks_[i].viewport = v;
      this.updateChildTracks_();
    },

    get firstCanvas() {
      if (this.tracks_.length)
        return this.tracks_[0].firstCanvas;
      return undefined;
    },

    /**
     * Picks a slice, if any, at a given location.
     * @param {number} wX X location to search at, in worldspace.
     * @param {number} wY Y location to search at, in offset space.
     *     offset space.
     * @param {function():*} onHitCallback Callback to call with the slice,
     *     if one is found.
     * @return {boolean} true if a slice was found, otherwise false.
     */
    pick: function(wX, wY, onHitCallback) {
      for (var i = 0; i < this.tracks_.length; i++) {
        var trackClientRect = this.tracks_[i].getBoundingClientRect();
        if (wY >= trackClientRect.top && wY < trackClientRect.bottom)
          return this.tracks_[i].pick(wX, onHitCallback);
      }
      return false;
    },

    /**
     * Finds slices intersecting the given interval.
     * @param {number} loWX Lower X bound of the interval to search, in
     *     worldspace.
     * @param {number} hiWX Upper X bound of the interval to search, in
     *     worldspace.
     * @param {number} loY Lower Y bound of the interval to search, in
     *     offset space.
     * @param {number} hiY Upper Y bound of the interval to search, in
     *     offset space.
     * @param {function():*} onHitCallback Function to call for each slice
     *     intersecting the interval.
     */
    pickRange: function(loWX, hiWX, loY, hiY, onHitCallback) {
      for (var i = 0; i < this.tracks_.length; i++) {
        var trackClientRect = this.tracks_[i].getBoundingClientRect();
        var a = Math.max(loY, trackClientRect.top);
        var b = Math.min(hiY, trackClientRect.bottom);
        if (a <= b)
          this.tracks_[i].pickRange(loWX, hiWX, loY, hiY, onHitCallback);
      }
    }
  };

  /**
   * Visualizes a TimelineThread using a series of of TimelineSliceTracks.
   * @constructor
   */
  var TimelineThreadTrack = cr.ui.define(TimelineContainerTrack);
  TimelineThreadTrack.prototype = {
    __proto__: TimelineContainerTrack.prototype,

    decorate: function() {
      this.classList.add('timeline-thread-track');
    },

    get thread(thread) {
      return this.thread_;
    },

    set thread(thread) {
      this.thread_ = thread;
      this.updateChildTracks_();
    },

    get tooltip() {
      return this.tooltip_;
    },

    set tooltip(value) {
      this.tooltip_ = value;
      this.updateChildTracks_();
    },

    get heading() {
      return this.heading_;
    },

    set heading(h) {
      this.heading_ = h;
      this.updateChildTracks_();
    },

    get headingWidth() {
      return this.headingWidth_;
    },

    set headingWidth(width) {
      this.headingWidth_ = width;
      this.updateChildTracks_();
    },

    addTrack_: function(slices) {
      var track = new TimelineSliceTrack();
      track.heading = '';
      track.slices = slices;
      track.headingWidth = this.headingWidth_;
      track.viewport = this.viewport_;

      this.tracks_.push(track);
      this.appendChild(track);
      return track;
    },

    updateChildTracks_: function() {
      this.detach();
      this.textContent = '';
      this.tracks_ = [];
      if (this.thread_) {
        if (this.thread_.cpuSlices) {
          var track = this.addTrack_(this.thread_.cpuSlices);
          track.height = '4px';
        }

        for (var srI = 0; srI < this.thread_.nonNestedSubRows.length; ++srI) {
          this.addTrack_(this.thread_.nonNestedSubRows[srI]);
        }
        for (var srI = 0; srI < this.thread_.subRows.length; ++srI) {
          this.addTrack_(this.thread_.subRows[srI]);
        }
        if (this.tracks_.length > 0) {
          if (this.thread_.cpuSlices) {
            this.tracks_[1].heading = this.heading_;
            this.tracks_[1].tooltip = this.tooltip_;
          } else {
            this.tracks_[0].heading = this.heading_;
            this.tracks_[0].tooltip = this.tooltip_;
          }
        }
      }
    }
  };

  /**
   * Visualizes a TimelineCpu using a series of of TimelineSliceTracks.
   * @constructor
   */
  var TimelineCpuTrack = cr.ui.define(TimelineContainerTrack);
  TimelineCpuTrack.prototype = {
    __proto__: TimelineContainerTrack.prototype,

    decorate: function() {
      this.classList.add('timeline-thread-track');
    },

    get cpu(cpu) {
      return this.cpu_;
    },

    set cpu(cpu) {
      this.cpu_ = cpu;
      this.updateChildTracks_();
    },

    get tooltip() {
      return this.tooltip_;
    },

    set tooltip(value) {
      this.tooltip_ = value;
      this.updateChildTracks_();
    },

    get heading() {
      return this.heading_;
    },

    set heading(h) {
      this.heading_ = h;
      this.updateChildTracks_();
    },

    get headingWidth() {
      return this.headingWidth_;
    },

    set headingWidth(width) {
      this.headingWidth_ = width;
      this.updateChildTracks_();
    },

    updateChildTracks_: function() {
      this.detach();
      this.textContent = '';
      this.tracks_ = [];
      if (this.cpu_) {
        var track = new TimelineSliceTrack();
        track.slices = this.cpu_.slices;
        track.headingWidth = this.headingWidth_;
        track.viewport = this.viewport_;

        this.tracks_.push(track);
        this.appendChild(track);

        this.tracks_[0].heading = this.heading_;
        this.tracks_[0].tooltip = this.tooltip_;
      }
    }
  };

  /**
   * A canvas-based track constructed. Provides the basic heading and
   * invalidation-managment infrastructure. Subclasses must implement drawing
   * and picking code.
   * @constructor
   * @extends {HTMLDivElement}
   */
  var CanvasBasedTrack = cr.ui.define('div');

  CanvasBasedTrack.prototype = {
    __proto__: HTMLDivElement.prototype,

    decorate: function() {
      this.className = 'timeline-canvas-based-track';
      this.slices_ = null;

      this.headingDiv_ = document.createElement('div');
      this.headingDiv_.className = 'timeline-canvas-based-track-title';
      this.appendChild(this.headingDiv_);

      this.canvasContainer_ = document.createElement('div');
      this.canvasContainer_.className =
          'timeline-canvas-based-track-canvas-container';
      this.appendChild(this.canvasContainer_);
      this.canvas_ = document.createElement('canvas');
      this.canvas_.className = 'timeline-canvas-based-track-canvas';
      this.canvasContainer_.appendChild(this.canvas_);

      this.ctx_ = this.canvas_.getContext('2d');
    },

    detach: function() {
      if (this.viewport_)
        this.viewport_.removeEventListener('change',
                                           this.viewportChangeBoundToThis_);
    },

    set headingWidth(width) {
      this.headingDiv_.style.width = width;
    },

    get heading() {
      return this.headingDiv_.textContent;
    },

    set heading(text) {
      this.headingDiv_.textContent = text;
    },

    set tooltip(text) {
      this.headingDiv_.title = text;
    },

    get viewport() {
      return this.viewport_;
    },

    set viewport(v) {
      this.viewport_ = v;
      if (this.viewport_)
        this.viewport_.removeEventListener('change',
                                           this.viewportChangeBoundToThis_);
      this.viewport_ = v;
      if (this.viewport_) {
        this.viewportChangeBoundToThis_ = this.viewportChange_.bind(this);
        this.viewport_.addEventListener('change',
                                        this.viewportChangeBoundToThis_);
      }
      this.invalidate();
    },

    viewportChange_: function() {
      this.invalidate();
    },

    invalidate: function() {
      if (this.rafPending_)
        return;
      webkitRequestAnimationFrame(function() {
        this.rafPending_ = false;
        if (!this.viewport_)
          return;

        if (this.canvas_.width != this.canvasContainer_.clientWidth)
          this.canvas_.width = this.canvasContainer_.clientWidth;
        if (this.canvas_.height != this.canvasContainer_.clientHeight)
          this.canvas_.height = this.canvasContainer_.clientHeight;

        this.redraw();
      }.bind(this), this);
      this.rafPending_ = true;
    },

    get firstCanvas() {
      return this.canvas_;
    }

  };

  /**
   * A track that displays an array of TimelineSlice objects.
   * @constructor
   * @extends {CanvasBasedTrack}
   */

  var TimelineSliceTrack = cr.ui.define(CanvasBasedTrack);

  TimelineSliceTrack.prototype = {

    __proto__: CanvasBasedTrack.prototype,

    decorate: function() {
      this.classList.add('timeline-slice-track');
    },

    get slices() {
      return this.slices_;
    },

    set slices(slices) {
      this.slices_ = slices;
      this.invalidate();
    },

    set height(height) {
      this.style.height = height;
    },

    redraw: function() {
      var ctx = this.ctx_;
      var canvasW = this.canvas_.width;
      var canvasH = this.canvas_.height;

      ctx.clearRect(0, 0, canvasW, canvasH);

      // Culling parameters.
      var vp = this.viewport_;
      var pixWidth = vp.xViewVectorToWorld(1);
      var viewLWorld = vp.xViewToWorld(0);
      var viewRWorld = vp.xViewToWorld(canvasW);

      // Draw grid without a transform because the scale
      // affects line width.
      if (vp.gridEnabled) {
        var x = vp.gridTimebase;
        ctx.beginPath();
        while (x < viewRWorld) {
          if (x >= viewLWorld) {
            // Do conversion to viewspace here rather than on
            // x to avoid precision issues.
            var vx = vp.xWorldToView(x);
            ctx.moveTo(vx, 0);
            ctx.lineTo(vx, canvasH);
          }
          x += vp.gridStep;
        }
        ctx.strokeStyle = 'rgba(255,0,0,0.25)';
        ctx.stroke();
      }

      // Begin rendering in world space.
      ctx.save();
      vp.applyTransformToCanavs(ctx);

      // Slices.
      var tr = new tracing.FastRectRenderer(ctx, viewLWorld, 2 * pixWidth,
                                            2 * pixWidth, viewRWorld, pallette);
      tr.setYandH(0, canvasH);
      var slices = this.slices_;
      for (var i = 0; i < slices.length; ++i) {
        var slice = slices[i];
        var x = slice.start;
        // Less than 0.001 causes short events to disappear when zoomed in.
        var w = Math.max(slice.duration, 0.001);
        var colorId = slice.selected ?
            slice.colorId + highlightIdBoost :
            slice.colorId;

        if (w < pixWidth)
          w = pixWidth;
        if (slice.duration > 0) {
          tr.fillRect(x, w, colorId);
        } else {
          // Instant: draw a triangle.  If zoomed too far, collapse
          // into the FastRectRenderer.
          if (pixWidth > 0.001) {
            tr.fillRect(x, pixWidth, colorId);
          } else {
            ctx.fillStyle = pallette[colorId];
            ctx.beginPath();
            ctx.moveTo(x - (4 * pixWidth), canvasH);
            ctx.lineTo(x, 0);
            ctx.lineTo(x + (4 * pixWidth), canvasH);
            ctx.closePath();
            ctx.fill();
          }
        }
      }
      tr.flush();
      ctx.restore();

      // Labels.
      if (canvasH > 8) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '10px sans-serif';
        ctx.strokeStyle = 'rgb(0,0,0)';
        ctx.fillStyle = 'rgb(0,0,0)';
        // Don't render text until until it is 20px wide
        var quickDiscardThresshold = pixWidth * 20;
        for (var i = 0; i < slices.length; ++i) {
          var slice = slices[i];
          if (slice.duration > quickDiscardThresshold) {
            var title = slice.title;
            if (slice.didNotFinish) {
              title += ' (Did Not Finish)';
            }
            var labelWidth = quickMeasureText(ctx, title) + 2;
            var labelWidthWorld = pixWidth * labelWidth;

            if (labelWidthWorld < slice.duration) {
              var cX = vp.xWorldToView(slice.start + 0.5 * slice.duration);
              ctx.fillText(title, cX, 2.5, labelWidth);
            }
          }
        }
      }
    },

    /**
     * Picks a slice, if any, at a given location.
     * @param {number} wX X location to search at, in worldspace.
     * @param {number} wY Y location to search at, in offset space.
     *     offset space.
     * @param {function():*} onHitCallback Callback to call with the slice,
     *     if one is found.
     * @return {boolean} true if a slice was found, otherwise false.
     */
    pick: function(wX, wY, onHitCallback) {
      var clientRect = this.getBoundingClientRect();
      if (wY < clientRect.top || wY >= clientRect.bottom)
        return false;
      var x = tracing.findLowIndexInSortedIntervals(this.slices_,
          function(x) { return x.start; },
          function(x) { return x.duration; },
          wX);
      if (x >= 0 && x < this.slices_.length) {
        onHitCallback('slice', this, this.slices_[x]);
        return true;
      }
      return false;
    },

    /**
     * Finds slices intersecting the given interval.
     * @param {number} loWX Lower X bound of the interval to search, in
     *     worldspace.
     * @param {number} hiWX Upper X bound of the interval to search, in
     *     worldspace.
     * @param {number} loY Lower Y bound of the interval to search, in
     *     offset space.
     * @param {number} hiY Upper Y bound of the interval to search, in
     *     offset space.
     * @param {function():*} onHitCallback Function to call for each slice
     *     intersecting the interval.
     */
    pickRange: function(loWX, hiWX, loY, hiY, onHitCallback) {
      var clientRect = this.getBoundingClientRect();
      var a = Math.max(loY, clientRect.top);
      var b = Math.min(hiY, clientRect.bottom);
      if (a > b)
        return;

      var that = this;
      function onPickHit(slice) {
        onHitCallback('slice', that, slice);
      }
      tracing.iterateOverIntersectingIntervals(this.slices_,
          function(x) { return x.start; },
          function(x) { return x.duration; },
          loWX, hiWX,
          onPickHit);
    },

    /**
     * Find the index for the given slice.
     * @return {index} Index of the given slice, or undefined.
     * @private
     */
    indexOfSlice_: function(slice) {
      var index = tracing.findLowIndexInSortedArray(this.slices_,
          function(x) { return x.start; },
          slice.start);
      while (index < this.slices_.length &&
          slice.start == this.slices_[index].start &&
          slice.colorId != this.slices_[index].colorId) {
        index++;
      }
      return index < this.slices_.length ? index : undefined;
    },

    /**
     * Return the next slice, if any, after the given slice.
     * @param {slice} The previous slice.
     * @return {slice} The next slice, or undefined.
     * @private
     */
    pickNext: function(slice) {
      var index = this.indexOfSlice_(slice);
      if (index != undefined) {
        if (index < this.slices_.length - 1)
          index++;
        else
          index = undefined;
      }
      return index != undefined ? this.slices_[index] : undefined;
    },

    /**
     * Return the previous slice, if any, before the given slice.
     * @param {slice} A slice.
     * @return {slice} The previous slice, or undefined.
     */
    pickPrevious: function(slice) {
      var index = this.indexOfSlice_(slice);
      if (index == 0)
        return undefined;
      else if ((index != undefined) && (index > 0))
        index--;
      return index != undefined ? this.slices_[index] : undefined;
    }

  };

  /**
   * A track that displays a TimelineCounter object.
   * @constructor
   * @extends {CanvasBasedTrack}
   */

  var TimelineCounterTrack = cr.ui.define(CanvasBasedTrack);

  TimelineCounterTrack.prototype = {

    __proto__: CanvasBasedTrack.prototype,

    decorate: function() {
      this.classList.add('timeline-counter-track');
    },

    get counter() {
      return this.counter_;
    },

    set counter(counter) {
      this.counter_ = counter;
      this.invalidate();
    },

    redraw: function() {
      var ctr = this.counter_;
      var ctx = this.ctx_;
      var canvasW = this.canvas_.width;
      var canvasH = this.canvas_.height;

      ctx.clearRect(0, 0, canvasW, canvasH);

      // Culling parametrs.
      var vp = this.viewport_;
      var pixWidth = vp.xViewVectorToWorld(1);
      var viewLWorld = vp.xViewToWorld(0);
      var viewRWorld = vp.xViewToWorld(canvasW);

      // Drop sampels that are less than skipDistancePix apart.
      var skipDistancePix = 1;
      var skipDistanceWorld = vp.xViewVectorToWorld(skipDistancePix);

      // Begin rendering in world space.
      ctx.save();
      vp.applyTransformToCanavs(ctx);

      // Figure out where drawing should begin.
      var numSeries = ctr.numSeries;
      var numSamples = ctr.numSamples;
      var startIndex = tracing.findLowIndexInSortedArray(ctr.timestamps,
                                                         function() {
                                                         },
                                                         viewLWorld);

      // Draw indices one by one until we fall off the viewRWorld.
      var yScale = canvasH / ctr.maxTotal;
      for (var seriesIndex = ctr.numSeries - 1;
           seriesIndex >= 0; seriesIndex--) {
        var colorId = ctr.seriesColors[seriesIndex];
        ctx.fillStyle = pallette[colorId];
        ctx.beginPath();

        // Set iLast and xLast such that the first sample we draw is the
        // startIndex sample.
        var iLast = startIndex - 1;
        var xLast = iLast >= 0 ? ctr.timestamps[iLast] - skipDistanceWorld : -1;
        var yLastView = canvasH;

        // Iterate over samples from iLast onward until we either fall off the
        // viewRWorld or we run out of samples. To avoid drawing too much, after
        // drawing a sample at xLast, skip subsequent samples that are less than
        // skipDistanceWorld from xLast.
        var hasMoved = false;
        while (true) {
          var i = iLast + 1;
          if (i >= numSamples) {
            ctx.lineTo(xLast, yLastView);
            ctx.lineTo(xLast + 8 * pixWidth, yLastView);
            ctx.lineTo(xLast + 8 * pixWidth, canvasH);
            break;
          }

          var x = ctr.timestamps[i];

          var y = ctr.totals[i * numSeries + seriesIndex];
          var yView = canvasH - (yScale * y);

          if (x > viewRWorld) {
            ctx.lineTo(x, yLastView);
            ctx.lineTo(x, canvasH);
            break;
          }

          if (x - xLast < skipDistanceWorld) {
            iLast = i;
            continue;
          }

          if (!hasMoved) {
            ctx.moveTo(viewLWorld, canvasH);
            hasMoved = true;
          }
          ctx.lineTo(x, yLastView);
          ctx.lineTo(x, yView);
          iLast = i;
          xLast = x;
          yLastView = yView;
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },

    /**
     * Picks a slice, if any, at a given location.
     * @param {number} wX X location to search at, in worldspace.
     * @param {number} wY Y location to search at, in offset space.
     *     offset space.
     * @param {function():*} onHitCallback Callback to call with the slice,
     *     if one is found.
     * @return {boolean} true if a slice was found, otherwise false.
     */
    pick: function(wX, wY, onHitCallback) {
    },

    /**
     * Finds slices intersecting the given interval.
     * @param {number} loWX Lower X bound of the interval to search, in
     *     worldspace.
     * @param {number} hiWX Upper X bound of the interval to search, in
     *     worldspace.
     * @param {number} loY Lower Y bound of the interval to search, in
     *     offset space.
     * @param {number} hiY Upper Y bound of the interval to search, in
     *     offset space.
     * @param {function():*} onHitCallback Function to call for each slice
     *     intersecting the interval.
     */
    pickRange: function(loWX, hiWX, loY, hiY, onHitCallback) {
    }

  };

  return {
    TimelineCounterTrack: TimelineCounterTrack,
    TimelineSliceTrack: TimelineSliceTrack,
    TimelineThreadTrack: TimelineThreadTrack,
    TimelineCpuTrack: TimelineCpuTrack
  };
});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.


/**
 * @fileoverview TimelineView visualizes TRACE_EVENT events using the
 * tracing.Timeline component.
 */
cr.define('tracing', function() {
  function tsRound(ts) {
    return Math.round(ts * 1000.0) / 1000.0;
  }
  function getPadding(text, width) {
    width = width || 0;

    if (typeof text != 'string')
      text = String(text);

    if (text.length >= width)
      return '';

    var pad = '';
    for (var i = 0; i < width - text.length; i++)
      pad += ' ';
    return pad;
  }

  function leftAlign(text, width) {
    return text + getPadding(text, width);
  }

  function rightAlign(text, width) {
    return getPadding(text, width) + text;
  }

  /**
   * TimelineView
   * @constructor
   * @extends {HTMLDivElement}
   */
  TimelineView = cr.ui.define('div');

  TimelineView.prototype = {
    __proto__: HTMLDivElement.prototype,

    decorate: function() {
      this.classList.add('timeline-view');

      this.timelineContainer_ = document.createElement('div');
      this.timelineContainer_.className = 'timeline-container';

      var summaryContainer_ = document.createElement('div');
      summaryContainer_.className = 'summary-container';

      this.summaryEl_ = document.createElement('pre');
      this.summaryEl_.className = 'summary';

      summaryContainer_.appendChild(this.summaryEl_);
      this.appendChild(this.timelineContainer_);
      this.appendChild(summaryContainer_);

      this.onSelectionChangedBoundToThis_ = this.onSelectionChanged_.bind(this);
    },

    set traceData(traceData) {
      this.model = new tracing.TimelineModel(traceData);
    },

    get model(model) {
      return this.timelineModel_;
    },

    set model(model) {
      this.timelineModel_ = model;

      // remove old timeline
      this.timelineContainer_.textContent = '';

      // create new timeline if needed
      if (this.timelineModel_.minTimestamp !== undefined) {
        if (this.timeline_)
          this.timeline_.detach();
        this.timeline_ = new tracing.Timeline();
        this.timeline_.model = this.timelineModel_;
        this.timeline_.focusElement = this.parentElement;
        this.timelineContainer_.appendChild(this.timeline_);
        this.timeline_.addEventListener('selectionChange',
                                        this.onSelectionChangedBoundToThis_);
        this.onSelectionChanged_();
      } else {
        this.timeline_ = null;
      }
    },

    get timeline() {
      return this.timeline_;
    },

    onSelectionChanged_: function(e) {
      var timeline = this.timeline_;
      var selection = timeline.selection;
      if (!selection.length) {
        var oldScrollTop = this.timelineContainer_.scrollTop;
        this.summaryEl_.textContent = timeline.keyHelp;
        this.timelineContainer_.scrollTop = oldScrollTop;
        return;
      }

      var text = '';
      if (selection.length == 1) {
        var c0Width = 14;
        var slice = selection[0].slice;
        text = 'Selected item:\n';
        text += leftAlign('Title', c0Width) + ': ' + slice.title + '\n';
        text += leftAlign('Start', c0Width) + ': ' +
            tsRound(slice.start) + ' ms\n';
        text += leftAlign('Duration', c0Width) + ': ' +
            tsRound(slice.duration) + ' ms\n';
        if (slice.durationInUserTime)
          text += leftAlign('Duration (U)', c0Width) + ': ' +
              tsRound(slice.durationInUserTime) + ' ms\n';

        var n = 0;
        for (var argName in slice.args) {
          n += 1;
        }
        if (n > 0) {
          text += leftAlign('Args', c0Width) + ':\n';
          for (var argName in slice.args) {
            var argVal = slice.args[argName];
            text += leftAlign(' ' + argName, c0Width) + ': ' + argVal + '\n';
          }
        }
      } else {
        var c0Width = 55;
        var c1Width = 12;
        var c2Width = 5;
        text = 'Selection summary:\n';
        var tsLo = Math.min.apply(Math, selection.map(
            function(s) {return s.slice.start;}));
        var tsHi = Math.max.apply(Math, selection.map(
            function(s) {return s.slice.end;}));

        // compute total selection duration
        var titles = selection.map(function(i) { return i.slice.title; });

        var slicesByTitle = {};
        for (var i = 0; i < selection.length; i++) {
          var slice = selection[i].slice;
          if (!slicesByTitle[slice.title])
            slicesByTitle[slice.title] = {
              slices: []
            };
          slicesByTitle[slice.title].slices.push(slice);
        }
        var totalDuration = 0;
        for (var sliceGroupTitle in slicesByTitle) {
          var sliceGroup = slicesByTitle[sliceGroupTitle];
          var duration = 0;
          for (i = 0; i < sliceGroup.slices.length; i++)
            duration += sliceGroup.slices[i].duration;
          totalDuration += duration;

          text += ' ' +
              leftAlign(sliceGroupTitle, c0Width) + ': ' +
              rightAlign(tsRound(duration) + 'ms', c1Width) + '   ' +
              rightAlign(String(sliceGroup.slices.length), c2Width) +
              ' occurrences' + '\n';
        }

        text += leftAlign('*Totals', c0Width) + ' : ' +
            rightAlign(tsRound(totalDuration) + 'ms', c1Width) + '   ' +
            rightAlign(String(selection.length), c2Width) + ' occurrences' +
            '\n';

        text += '\n';

        text += leftAlign('Selection start', c0Width) + ' : ' +
            rightAlign(tsRound(tsLo) + 'ms', c1Width) +
            '\n';
        text += leftAlign('Selection extent', c0Width) + ' : ' +
            rightAlign(tsRound(tsHi - tsLo) + 'ms', c1Width) +
            '\n';
      }

      // done
      var oldScrollTop = this.timelineContainer_.scrollTop;
      this.summaryEl_.textContent = text;
      this.timelineContainer_.scrollTop = oldScrollTop;
    }
  };

  return {
    TimelineView: TimelineView
  };
});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.


/**
 * @fileoverview Provides a mechanism for drawing massive numbers of
 * colored rectangles into a canvas in an efficient manner, provided
 * they are drawn left to right with fixed y and height throughout.
 *
 * The basic idea used here is to fuse subpixel rectangles together so that
 * we never issue a canvas fillRect for them. It turns out Javascript can
 * do this quite efficiently, compared to asking Canvas2D to do the same.
 *
 * A few extra things are done by this class in the name of speed:
 * - Viewport culling: off-viewport rectangles are discarded.
 *
 * - The actual discarding operation is done in world space,
 *   e.g. pre-transform.
 *
 * - Rather than expending compute cycles trying to figure out an average
 *   color for fused rectangles from css strings, you instead draw using
 *   palletized colors. The fused rect is the max pallete index encountered.
 *
 * Make sure to flush the trackRenderer before finishing drawing in order
 * to commit any queued drawing operations.
 */
cr.define('tracing', function() {

  /**
   * Creates a fast rect renderer with a specific set of culling rules
   * and color pallette.
   * @param {GraphicsContext2D} ctx Canvas2D drawing context.
   * @param {number} vpLeft The leftmost visible part of the drawing viewport.
   * @param {number} minRectSize Only rectangles with width < minRectSize are
   *    considered for merging.
   * @param {number} maxMergeDist Controls how many successive small rectangles
   *    can be merged together before issuing a rectangle.
   * @param {number} vpRight The rightmost visible part of the viewport.
   * @param {Array} pallette The color pallete for drawing. Pallette slots
   *    should map to valid Canvas fillStyle strings.
   *
   * @constructor
   */
  function FastRectRenderer(ctx, vpLeft, minRectSize, maxMergeDist, vpRight,
                            pallette) {
    this.ctx_ = ctx;
    this.vpLeft_ = vpLeft;
    this.minRectSize_ = minRectSize;
    this.maxMergeDist_ = maxMergeDist;
    this.vpRight_ = vpRight;
    this.pallette_ = pallette;
  }

  FastRectRenderer.prototype = {
    y_: 0,
    h_: 0,
    merging_: false,
    mergeStartX_: 0,
    mergeCurRight_: 0,

    /**
     * Changes the y position and height for subsequent fillRect
     * calls. x and width are specifieid on the fillRect calls.
     */
    setYandH: function(y, h) {
      this.flush();
      this.y_ = y;
      this.h_ = h;
    },

    /**
     * Fills rectangle at the specified location, if visible. If the
     * rectangle is subpixel, it will be merged with adjacent rectangles.
     * The drawing operation may not take effect until flush is called.
     * @param {number} colorId The color of this rectangle, as an index
     *     in the renderer's color pallete.
     */
    fillRect: function(x, w, colorId) {
      var r = x + w;
      if (r < this.vpLeft_ || x > this.vpRight_) return;
      if (w < this.minRectSize_) {
        if (r - this.mergeStartX_ > this.maxMergeDist_)
          this.flush();
        if (!this.merging_) {
          this.merging_ = true;
          this.mergeStartX_ = x;
          this.mergeCurRight_ = r;
          this.mergedColorId = colorId;
        } else {
          this.mergeCurRight_ = r;
          this.mergedColorId = Math.max(this.mergedColorId, colorId);
        }
      } else {
        if (this.merging_)
          this.flush();
        this.ctx_.fillStyle = this.pallette_[colorId];
        this.ctx_.fillRect(x, this.y_, w, this.h_);
      }
    },

    /**
     * Commits any pending fillRect operations to the underlying graphics
     * context.
     */
    flush: function() {
      if (this.merging_) {
        this.ctx_.fillStyle = this.pallette_[this.mergedColorId];
        this.ctx_.fillRect(this.mergeStartX_, this.y_,
                           this.mergeCurRight_ - this.mergeStartX_, this.h_);
        this.merging_ = false;
      }
    }
  };

  return {
    FastRectRenderer: FastRectRenderer
  };

});
// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Helper functions for use in tracing tests.
 */


/**
 * goog.testing.assertion's assertEquals tweaked to do equality-to-a-constant.
 * @param {*} a First value.
 * @param {*} b Second value.
 */
function assertAlmostEquals(a, b) {
  _validateArguments(2, arguments);
  var var1 = nonCommentArg(1, 2, arguments);
  var var2 = nonCommentArg(2, 2, arguments);
  _assert(commentArg(2, arguments), Math.abs(var1 - var2) < 0.00001,
          'Expected ' + _displayStringForValue(var1) + ' but was ' +
          _displayStringForValue(var2));
}

cr.define('test_utils', function() {
  function getAsync(url, cb) {
    var req = new XMLHttpRequest();
    req.open('GET', url, true);
    req.onreadystatechange = function(aEvt) {
      if (req.readyState == 4) {
        window.setTimeout(function() {
          if (req.status == 200) {
            cb(req.responseText);
          } else {
            console.log('Failed to load ' + url);
          }
        }, 0);
      }
    };
    req.send(null);
  }
  return {
    getAsync: getAsync
  };
});
