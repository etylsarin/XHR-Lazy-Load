/**
 * @fileoverview xhr lazy loading script
 * @version 1.0.1b (09-MAR-2011)
 * @author Filip Mares - http:// www.filip-mares.co.uk/
 *
 * Dual licensed under the MIT and GPL licenses:
 * http:// www.opensource.org/licenses/mit-license.php
 * http:// www.gnu.org/licenses/gpl.html
*/

/*jslint eqeqeq: true, undef: true */

/*
Usage Note:
-----------
Here is an example how to use xhr lazy loading
Parameters and their values are mostly optional

	// default public method for advanced usage
	$XLL.load({
		src: 'myScript.js', //required attribute, source file to be lazy loaded
		type: 'js', //optional attribute, 'js' by default, other possible value is 'css'
		async: false, //optional attribute, true by default, when set to true loading order of the related file is preserved
		ajax: false, //optional attribute, true by default, decides if the source file is loaded by xhr
		attributes: {id: 'myFile'}, //optional attribute, undefined by default, allows user to add specific attributes to assets
		// allowed attributes for script tag: id, type, charset
		// allowed attributes for link or style tag: id, media, title
		timeout: 5000, //optional attribute, 5 seconds by default, after the period fires error event so the rest of the queue can be processed
		success: myCallbackFunction, //optional attribute, callback function executed if the loading proces is successful
		error: myErrorFunction //optional attribute, error function executed if the loading proces is unsuccessful
	});
	// public method for reseting the default settings
	$XLL.defaults({
		// all the same settings like for load method except src
		asyncAjaxDownloads: 2 // optional attribute, 4 by default, number of AJAX paralel downloads
	});
	// shorthand for asynchronous ajax load of JavaScript file
	$XLL.script(
		'myScript.js', //required attribute, source file to be lazy loaded
		myCallbackFunction, //optional attribute, callback function executed if the loading proces is successful
		myErrorFunction //optional attribute, error function executed if the loading proces is unsuccessful
	);
	// shorthand for asynchronous ajax load of Style Sheet
	$XLL.css(
		'myStyleSheet.css', //required attribute, source file to be lazy loaded
		myCallbackFunction, //optional attribute, callback function executed if the loading proces is successful
		myErrorFunction //optional attribute, error function executed if the loading proces is unsuccessful
	);
	// shorthand for synchronous blocker with callback
	$XLL.wait({
		success: myCallbackFunction //optional attribute, callback function to be executed
	});
*/

var $XLL = (function (global) {

	// -- Private properties ---------------------------------------------------

	// constants kept for performance reasons
	var TRUE = true,
		FALSE = false,
		NULL = null,
		JSTYPE = 'text/javascript',
		CSSTYPE = 'text/css',
		// local pointer to the document element
		document = global.document,
		// define the custom properties set with default values
		customDefaults = {
			src: '',
			type: 'script',
			async: TRUE,
			ajax: TRUE,
			attributes: {
				id: '',
				type: JSTYPE,
				charset: '',
				media: '',
				title: ''
			},
			success: function(){},
			error: function(){},
			// set a default timeout for the case when erro occures
			timeout: 5000, // 5s
			// set a default limit for AJAX paralel downloads
			asyncAjaxDownloads: 4
		},
		// create a queue object constructor and set up it's default values
		Queue = function () {
			this.queue = [];
			this.blockers = [];
			this.ajaxQueue = [];
			this.lowerBound = 0;
			this.activeAjaxDownloads = 0;
		},
		// create a queue item object constructor and set up it's default values
		QueueItem = function () {
			this.index = 0;
			this.errorThrown = NULL;
			this.processed = 0;
			this.content = '';
			this.node = NULL;
			this.settings = NULL;
		},
		// set a global queue variable
		globalQueue = NULL,

	// -- Private functions ----------------------------------------------------

		/**
		 * Simple URL parser
		 *
		 * @param {String} urlString is any URL string
		 * @returns Object with three attributes: protocol, host and the relative
		 * @type Object
		 * @private
		 */
		parseUrl = function parseUrl(urlString) {
			var urlRegExp = /^(https?:)\/\/([\w\d\.\-_%:@]+)\/?/,
				tempArray = urlString.replace(/^\s+/, '').replace(/\s+$/, '').split(urlRegExp);

			return tempArray.length !== 4 ?
				{
					protocol: '',
					host: '',
					relative: tempArray[0]
				} : {
					protocol: tempArray[1],
					host: tempArray[2],
					relative: tempArray[3]
				};
		},

		/**
		* Create extended custom object with a specified prototype objects,
		* Its values can be changed by user with a different ones, but of the same type.
		*
		* @param {Object} prototypeObj is a prototype of the extended object.
		* @param {Object} customObj is an object containing user's settings.
		* @returns a new object with a prototype and custom values.
		* @type Object
		* @private
		*/
		extendObj = function extendObj(prototypeObj, customObj) {
			var TempObj = function(){},
				returnObj,
				// this function recursively iterate over the extensionObj object's properties
				extend = function (prototypeObj, targetObj, extensionObj) {
					var key, value, valueType, prototypeValue;
					for (key in extensionObj) {
						if (extensionObj.hasOwnProperty(key)) {
							value = extensionObj[key];
							valueType = typeof value;
							prototypeValue = prototypeObj[key];
							// check whether the extensionObj attribute type is the same like in prototype's object
							if (typeof prototypeValue === valueType) {
								// in term of seeking an object, call the function recursively otherwise use the value
								targetObj[key] = valueType === 'object' ? extend(prototypeValue, extendObj(prototypeValue), value) : value;
							}
						}
					}
					return targetObj;
				};
			// set the prototype
			TempObj.prototype = prototypeObj;
			returnObj = new TempObj();
			if (customObj) {
				extend(prototypeObj, returnObj, customObj);
			}
			return returnObj;
		},

		/**
		 * Create a hidden iframe, inject it to the page and return a pointer to it
		 *
		 * @param {HTMLElement} context element for iframe's injection
		 * @returns Object which store pointers to the iframe's node and iframe's document
		 * @type Object
		 * @private
		 */
		createIframe = function createIframe(context) {
			var iframe = document.createElement('iframe'),
				iframeDoc;

			// set iframe as a non-displayed element to avoid repaints and reflows
			iframe.style.display = 'none';
			context.appendChild(iframe);
			if (iframe.contentDocument) { // modern browsers
				iframeDoc = iframe.contentDocument;
			} else if (iframe.contentglobal) { // IE5.5 and IE6
				iframeDoc = iframe.contentglobal;
			}
			if (iframeDoc && iframeDoc.document) {
				iframeDoc = iframeDoc.document;
			}
			// return iframe node and its document object
			return {iframe: iframe, document: iframeDoc};
		},

	// -- Private methods ------------------------------------------------------

		/**
		 * Create a specified HTML element with appropriate attributes.
		 *
		 * @param {Object} queueItem store all relevant information to create a node
		 * @returns node if the essential input values are correct or null in all other cases
		 * @type HTMLElement
		 * @private
		 */
		createNode = function createNode() {
			var doc = document,
				node = NULL,
				that = this,
				content = that.content,
				settings = that.settings,
				src = settings.src,
				type = settings.type,
				attributes = settings.attributes,
				key;

			switch (type) {
			case 'script':
				// creates a script node
				node = doc.createElement('script');
				if (content > '') {
					//IE can't append node to the script element
					if (node.canHaveChildren !== FALSE) {
						node.appendChild(doc.createTextNode(content));
					} else {
						node.text = content;
					}
				} else {
					node.setAttribute('src', src);
				}
				if (attributes.type === CSSTYPE) {
					attributes.type = JSTYPE;
				}
				break;
			case 'css':
				// creates a link (stylesheet) node
				if (content > '') {
					node = doc.createElement('style');
					//IE can't append node to the style element
					if (!node.styleSheet) {
						node.appendChild(doc.createTextNode(content));
					} else {
						node.styleSheet.cssText = content;
					}
				} else {
					node = doc.createElement('link');
					node.setAttribute('rel', 'stylesheet');
					node.setAttribute('href', src);
				}
				if (attributes.type === JSTYPE) {
					attributes.type = CSSTYPE;
				}
				break;
			}
			// setting the attributes
			for (key in attributes) {
				if (typeof attributes[key] === 'string' && attributes[key] > '') {
					node.setAttribute(key, attributes[key]);
				}
			}
			that.node = node;
			return that;
		},

		/**
		 * Load the specified resources in parallel using xhr method
		 *
		 * @param {Object} queueItem store all relevant information to create a XHR connection
		 * @param {Function} callback (optional) callback function to execute when the resource is loaded
		 * @private
		 */
		xhrload = (function () {
			// Find out whether the XMLHttpRequest method is defined for actual browser. If not, try to use browser specific one.
			var XMLHttpRequest = function XMLHttpRequest() {
					// unsafe construction which causes an error in case both ActiveXObject and XMLHttpRequest aren't constructors
					return global.ActiveXObject ? new global.ActiveXObject('Microsoft.XMLHTTP') : new global.XMLHttpRequest();
				};

			return function xhrload(callback) { 
				var win = global,
					that = this,
					settings = that.settings,
					xhr, asyncTimeout;

				// test whether the XMLHttpRequest is defined and queueItem variable is an object
				if (XMLHttpRequest) {
					xhr = new XMLHttpRequest();
					that.errorThrown = 2;
					// timeout for requests over an unreliable network
					asyncTimeout = win.setTimeout(function () {
						xhr.abort();
						callback(that);
					}, settings.timeout);
					xhr.onreadystatechange = function () {
						var status = xhr.status;
						// readyState 4 menas complete
						if (xhr.readyState === 4) {
							win.clearTimeout(asyncTimeout);
							if (status >= 200 && status < 300 || status === 304) {
								that.content = xhr.responseText;
								that.errorThrown = NULL;
							// something went wrong with XMLHttpRequest
							} else if (status === 0) {
								that.errorThrown = 1;
							}
							callback(that);
						}
					};
					xhr.open('GET', settings.src, TRUE);
					xhr.send(NULL);
				} else {
					// the XMLHttpRequest is not defined
					customDefaults.ajax = FALSE;
					that.errorThrown = 1;
					callback(that);
				}
				return that;
			};
		}()),

		/**
		 * Choose the browser's native event handling method and return it for the next usage.
		 *
		 * @returns event handling method for actual browser
		 * @type Function
		 * @private
		 */
		addEventListener = (function () {
			// first time the script is being executed just return an adequate method for particular browser
			// all modern browsers support addEventListener method
			if (global.addEventListener) {
				return function addEventListener(callback) {
					var that = this,
						currentNode = that.node,
						iframeDocument;
					// test whether is the node an iframe
					if (currentNode.iframe) {
						iframeDocument = currentNode.document;
						currentNode = currentNode.iframe;
					}
					// and create onload event
					currentNode.addEventListener('load', function XLLload() {
						var	isTypeCss = that.settings.type === 'css',
							loadedStyleSheet, rules;
						if (isTypeCss && iframeDocument) {
							loadedStyleSheet = iframeDocument.styleSheets[0];
							rules = loadedStyleSheet.cssRules;
							// test whether the stylesheet has been loaded
							if (!rules || rules.length === 0) {
								that.errorThrown = 3;
							}
						} else if (isTypeCss) {
							that.errorThrown = 3;
						}
						callback(that);
					}, FALSE);
					// in case of having problems with loading the linked file
					currentNode.addEventListener('error', function XLLerror() {
						that.errorThrown = 3;
						callback(that);
					}, FALSE);
					return that;
				};
			// IE6 & IE7 support attachEvent method instead of addEventListener
			} else if (global.attachEvent) {
				return function addEventListener(callback) {
					var that = this,
						currentNode = that.node;
					// onload event for IE, unfortunately the readyState is equal to loaded even in case of error occurrence
					currentNode.attachEvent('onreadystatechange', function () {
						var currentNode = this,
							readyState = currentNode.readyState,
							loadedStyleSheet, rules;
						// shorthand for readyState === 'loaded' || readyState === 'complete'
						if (({loaded: 1, complete: 1})[readyState]) {
							// IE memory leak fix
							currentNode.onreadystatechange = NULL;
							if (that.settings.type === 'css') {
								loadedStyleSheet = currentNode.styleSheet;
								rules = loadedStyleSheet.rules;
								// test whether the stylesheet has been loaded
								if (!rules || rules.length === 0) {
									that.errorThrown = 3;
								}
							}
							callback(that);
						}
					});
					return that;
				};
			} else {
				return NULL;
			}
		}()),

		/**
		 * Iterate through an array of nodes and inject them into the page.
		 * When done, call the callback function.
		 *
		 * @param {Array} queueItemsArray array of nodes and their settings to be processed.
		 * @param {Function} callback (optional) callback function to execute when the nodes are injected.
		 * @private
		 */
		injectToDOM = function injectToDOM(callback) {
			var win = global,
				doc = document,
				that = this,
				queueItemsArray = that.queue,
				queueItemsArrayLen = queueItemsArray.length,
				itemsToProceed = queueItemsArrayLen,
				fragment = doc.createDocumentFragment(),
				fragmentInjected = FALSE,
				syncTimeout = [],
				i, iframeDocument, queueItem, settings, currentNode,
				documentNodes = doc.documentElement.childNodes,
				headElement = documentNodes[0],
				bodyElement = documentNodes[1],
				// function which is called after the node's injection
				onLoadComplete = function onLoadComplete(queueItem) {
					var iframe;
					if (queueItem) {
						// clear the timeout
						win.clearTimeout(syncTimeout[queueItem.index]);
						if (queueItem.node.iframe) {
							iframe = queueItem.node.iframe;
							if (!queueItem.errorThrown) {
								// move the successfully loaded assets from the iframe to the parent page and remove the iframe
								queueItem.node = queueItem.node.node;
								headElement.appendChild(queueItem.node);
							} else {
								queueItem.node = NULL;
							}
							bodyElement.removeChild(iframe);
						}
						itemsToProceed -= 1;
					}
					// wait with callback until the end of injecting process
					if (fragmentInjected && !itemsToProceed) {
						callback(queueItemsArray);
					}
				},
				// timeout function for browsers which don't support loading error event
				onTimeout = function (queueItem) {
					return function onTimeout() {
						queueItem.errorThrown = 3;
						onLoadComplete(queueItem);
					};
				};

			for (i = 0; i < queueItemsArrayLen; i += 1) {
				queueItem = queueItemsArray[i];
				settings = queueItem.settings;
				if (settings.type !== 'wait') {
					currentNode = queueItem.createNode().node;
					// after the period fires error event so the rest of the queue can be processed in case it's being held by event firing issue
					syncTimeout[queueItem.index] = win.setTimeout(onTimeout(queueItem), settings.timeout);
					// if the asset has been downloaded by ajax simply inject the node into the head of a page
					if (settings.ajax) {
						fragment.appendChild(currentNode);
						queueItem.node = currentNode;
						onLoadComplete(queueItem);
					// otherwise test the asset's type
					} else {
						// IE doesn't support addEventListener up to version 9
						if (settings.type === 'css' && win.addEventListener === 'function') {
							// if the type is css it is neccessary to create an iframe because link tag has no onload event by its own
							queueItem.node = createIframe(bodyElement);
							iframeDocument = queueItem.node.document;
							// Inject the assets to the iframe
							iframeDocument.open();
							iframeDocument.documentElement.firstChild.appendChild(currentNode);
							iframeDocument.close();
							queueItem.node.node = currentNode;
							currentNode = queueItem.node.iframe;
						// in case of js file or IE browser simply add the assets to the head of a page
						} else {
							fragment.appendChild(currentNode);
							queueItem.node = currentNode;
						}
						if (addEventListener) {
							queueItem.addEventListener(onLoadComplete);
						}
					}
				}
			}
			// inject the document fragment
			headElement.appendChild(fragment);
			fragmentInjected = TRUE;
			onLoadComplete();
			return that;
		},

		/**
		 * Push the settings item into the global queue.
		 *
		 * @param {Object} queueItem object to be queued.
		 * @returns updated global queue array.
		 * @type Array
		 * @private
		 */
		queuePush = function queuePush(queueItem) {
			var that = this,
				queue = that.queue,
				index = queue.length,
				settings = queueItem.settings,
				src = settings.src,
				currentUrl = global.location,
				currentDomain = currentUrl.protocol + currentUrl.host,
				parsedUrl, parsedDomain, ajax;

			if (src > '') {
				// set the actual index
				queueItem.index = index;
				if (!settings.hasOwnProperty('ajax')) {
					parsedUrl = parseUrl(src);
					parsedDomain = parsedUrl.protocol + parsedUrl.host;
					// check whether the requested domain and actual domain are the same
					if (parsedDomain > '' && parsedDomain !== currentDomain) {
						settings.ajax = FALSE;
					}
				}
			} else {
				settings.ajax = FALSE;
			}
			ajax = settings.ajax;
			// push current item in the queue
			queue.push(queueItem);
			if (!settings.async) {
				// if the item is a blocker push its index to the blockers's queue
				that.blockers.push(index);
			}
			// test whether the item should be loaded by ajax, if yes, check the number of actual asynchronous downloads
			if (!ajax || that.activeAjaxDownloads < settings.asyncAjaxDownloads) {
				queueItem.processed = 1;
				if (ajax) {
					that.activeAjaxDownloads += 1;
					queueItem.xhrload(function ajaxLoad(queueItem) {
						// xhrload method's callback function
						var settings = queueItem.settings,
							queueObj = that,
							ajaxQueue = queueObj.ajaxQueue;
						// ajax call returns errorThrown equal to 1 when the assets are situated on a different server
						if (queueItem.errorThrown === 1 && !settings.hasOwnProperty('ajax')) {
							// in case the user doesn't set the ajax attribute try to load it again without using ajax
							queueItem.errorThrown = NULL;
							settings.ajax = FALSE;
						}
						// pop the item from the queue
						queueObj.queuePop(queueItem);
						if (ajaxQueue.length > 0) {
							// process next item from the ajax queue
							queueObj.queue[ajaxQueue.shift()].xhrload(ajaxLoad);
						} else {
							that.activeAjaxDownloads -= 1;
						}
					});
				}
			} else {
				// push the item into the ajax queue for later processing
				that.ajaxQueue.push(index);
			}
			return that;
		},

		/**
		 * Iterate through the global queue and handle the settings items.
		 *
		 * @param {Object} (optional) queueItem object to be handle.
		 * @returns updated global queue array.
		 * @type Array
		 * @private
		 */
		queuePop = function queuePop(queueItem) {
			var that = this,
				blockers = that.blockers,
				queue = that.queue,
				processQueueObj = new Queue(),
				processQueue = processQueueObj.queue,
				i = that.lowerBound,
				// set the upper limit to the last item in the queue
				upperLimit = queue.length - 1,
				currentItem;
				
			if (blockers.length > 0) {
				// set the upper limit to the first item in the blockers queue
				upperLimit = blockers[0];
			}
			if (queueItem) {
				// in case the pop method has been called providing a specific item, set both bounds to its index
				i = queueItem.index;
				if (upperLimit > i) {
					upperLimit = i;
				}
			}
			while (i <= upperLimit) {
				// create a temporary queue from items which are ready to be processed
				currentItem = queue[i];
				if (currentItem.processed === 1) {
					currentItem.processed = 2;
					processQueue.push(currentItem);
				}
				i += 1;
			}
			if (processQueue.length > 0) {
				// pass the temporary queue to injectToDOM method
				processQueueObj.injectToDOM(function (queueItemsArray) {
					// injectToDOM method's callback function
					var globalQueue = that,
						queueLen = queueItemsArray.length,
						blockerResolved = FALSE,
						queueItem, settings, i;
					// iterate over injected items
					for (i = 0; i < queueLen; i += 1) {
						queueItem = queueItemsArray[i];
						settings = queueItem.settings;
						if (!queueItem.errorThrown) {
							if (!settings.async) {
								blockers.shift();
								blockerResolved = TRUE;
							}
							queueItem.processed = 3;
							// test whether it was the first item in the queue, then increase the lower bound
							if ((globalQueue.lowerBound + 1) === queueItem.index) {
								globalQueue.lowerBound += 1;
							}
							// call the user's success callback
							settings.success();
						} else {
							// call the user's error callback
							settings.error();
						}
					}
					if (blockerResolved) {
						globalQueue.queuePop();
					}
				});
			}
			return that;
		};

	// -- One-time init procedures ---------------------------------------------
	// extend queue prototype with new methods
	Queue.prototype = {
		queuePush: queuePush,
		queuePop: queuePop,
		injectToDOM: injectToDOM
	};
	// create a global queue object
	globalQueue = new Queue();
	// extend queue item prototype with new methods
	QueueItem.prototype = {
		xhrload: xhrload,
		createNode: createNode,
		addEventListener: addEventListener
	};

	// -- Public API -----------------------------------------------------------
	return {
		/**
		 * global API's load method adds a file with specific settings to the queue 
		 *
		 * @param {Object} options object with user's settings.
		 * @returns the application object to allow the chaining pattern.
		 * @type Object
		 * @public
		 */
		load: function load(settings) {
			var queueItem, attributes;
			// extend user parameters object with default parameters, remove all unexpected values from the object
			if (typeof settings === 'object') {
				if (!settings.attributes) {
					settings.attributes = {};
				}
				queueItem = new QueueItem();
				// extend the settings object
				queueItem.settings = extendObj(customDefaults, settings);
				globalQueue.queuePush(queueItem);
				// for the first run create a setTimeout function to fire the dequeue process
				if (globalQueue.queue.length === 1) {
					global.setTimeout(function () {
						globalQueue.queuePop();
					}, 25);
				}
			}
			return this;
		},
		/**
		 * global API's defaults method replace the global setting object with new one
		 *
		 * @param {Object} options object with user's settings.
		 * @returns the application object to allow the chaining pattern.
		 * @type Object
		 * @public
		 */
		defaults: function defaults (settings) {
			if (typeof settings === 'object') {
				settings.src = '';
				customDefaults = extendObj(customDefaults, settings);
			}
			return this;
		},
		/**
		 * global API's script method adds a JS file to the queue 
		 *
		 * @param {String} src of file to be loaded.
		 * @param {Function} callback function defined by user.
		 * @param {Function} error function defined by user.
		 * @returns the application object to allow the chaining pattern.
		 * @type Object
		 * @public
		 */
		script: function script(src, callback, error) {
			$XLL.load({
				src: src,
				callback: callback,
				error: error,
				type: 'script',
				atrributes: {
					type: JSTYPE
				}
			});
			return this;
		},
		/**
		 * global API's css method adds a css file to the queue 
		 *
		 * @param {String} src of file to be loaded.
		 * @param {Function} callback function defined by user.
		 * @param {Function} error function defined by user.
		 * @returns the application object to allow the chaining pattern.
		 * @type Object
		 * @public
		 */
		css: function css(src, callback, error) {
			$XLL.load({
				src: src,
				callback: callback,
				error: error,
				type: 'css',
				atrributes: {
					type: CSSTYPE
				}
			});
			return this;
		},
		/**
		 * global API's wait method adds a load blocking item to the queue 
		 *
		 * @param {Function} callback function defined by user.
		 * @returns the application object to allow the chaining pattern.
		 * @type Object
		 * @public
		 */
		wait: function wait(callback) {
			$XLL.load({
				async: FALSE,
				callback: callback,
				type: 'wait'
			});
			return this;
		}
	};
}(this));