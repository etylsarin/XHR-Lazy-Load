/**
 * @fileoverview xhr lazy loading script
 * @version 0.4.0 (10-FEB-2011)
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
Parameters and their values are optional

	$XLL.load({
		src: 'myScript.js', //required attribute, source file to be lazy loaded
		type: 'js', //optional attribute, 'js' by default, other possible value is 'css'
		fixOrder: true, //optional attribute, false by default, when set to true loading order of the related file is preserved
		ajax: false, //optional attribute, true by default, decides if the source file is loaded by xhr
		attributes: {id: 'myFile'}, //optional attribute, undefined by default, allows user to add specific attributes to assets
		// allowed attributes for script tag: id
		// allowed attributes for link or style tag: id, media, title
		timeout: 5000, //optional attribute, 5 seconds by default, after the period fires error event so the rest of the queue can be processed
		callback: myCallbackFunction //optional attribute, callback function executed if the loading proces is successful
		error: myErrorFunction //optional attribute, error function executed if the loading proces is unsuccessful
	})
	$XLL.exec({
		fixOrder: true, //optional attribute, false by default, when set to true loading order of the related file is preserved
		callback: myCallbackFunction //optional attribute, callback function to be executed
	})
*/

var $XLL = (function (window) {

	// -- Private properties ---------------------------------------------------

	// constants kept for performance reasons
	var TRUE = true,
		FALSE = false,
		NULL = null,
		// local pointer to the document element
		document = window.document,
		// define which attributes could be applied for js and css files
		customAttributes = {
			js: ['id'],
			css: ['id', 'media', 'title']
		},
		// define the custom properties set with default values
		customProperties = {
			// define public ones which could be reset by user settings
			pub: {
				src: '',
				type: 'js',
				fixOrder: FALSE,
				ajax: TRUE,
				attributes: NULL,
				timeout: 5000,
				callback: function(){},
				error: function(){}
			},
			// define private ones which are just for internal use
			pvt: {
				loadError: 0,
				processed: 0,
				index: 0,
				content: '',
				node: NULL
			}
		},
		// create a global queue object and set up it's default values
		globalQueue = {
			queue: [],
			blockers: [],
			ajaxQueue: [],
			lowerLimit: 0,
			ajaxDownloads: 0,
			// set a default limit for AJAX paralel downloads
			ajaxDownloadsLimit: 4
		},

	// -- Private methods ------------------------------------------------------

		/**
		 * Find out whether the XMLHttpRequest method is defined for actual browser.
		 * If not, try to use browser specific one.
		 *
		 * @returns a constructor function for the XMLHttpRequest object or undefined when the browser doesn't support it.
		 * @private
		 */
		XMLHttpRequest = (function () {
			if (typeof window.XMLHttpRequest === 'function') {
				return function () {
					return new window.XMLHttpRequest();
				};
			} else if (typeof window.ActiveXObject === 'function') {
				return function () {
					return new window.ActiveXObject('Microsoft.XMLHTTP');
				};
			} else {
				return undefined;
			}
		}()),

		/**
		 * Replace array's native indexOf method in case the native one's missing.
		 *
		 * @returns a inArray function miming the Array's indexOf method functionality.
		 * @type Function
		 * @private
		 */
		inArray = (function () {
			if (Array.indexOf) {
				return function inArray (elem, array) {
					return array.indexOf(elem);
				};
			} else {
				return function inArray (elem, array) {
					var i = array.length;
					while (i) {
						if ( array[i - 1] === elem) {
							return (i - 1);
						}
						i -= 1;
					}
					return -1;
				};
			}
		}()),
		
		/**
		 * Create extended custom object with a specified prototype objects,
		 * allow changing only properties defined in customPublic object.
		 *
		 * @param {Object} customPublic is a prototype of the extended object. Its values can be changed by user.
		 * @param {Object} customPrivate is a prototype of the extended object. Its values can't be changed by user.
		 * @returns a constructor function which creates an object using provided settings.
		 * @type Function
		 * @private
		 */
		extendCustomObject = function (customPublic, customPrivate) {
			var base = (function (pub, pvt) {
					var returnObj = {},
						customKeys = [],
						setProtoValue = function (obj, custom) {
							for (var propertyName in obj) {
								if (obj.hasOwnProperty(propertyName)) {
									if (custom) {
										customKeys.push(propertyName);
									}
									returnObj[propertyName] = obj[propertyName];
								}
							}
						};
					setProtoValue(pvt, FALSE);
					setProtoValue(pub, TRUE);
					returnObj.setValue = function (key, value) {
						if (inArray(key, customKeys) > -1 && typeof this[key] === typeof value) {
							this[key] = value;
						}
					};
					return returnObj;
				}(customPublic, customPrivate)),
				/**
				 * @constructor
				 */
				CustomObject = function CustomObject(customObj) {
					var propertyName;
					if (typeof customObj === 'object') {
						for (propertyName in customObj) {
							if (customObj.hasOwnProperty(propertyName)) {
								this.setValue(propertyName, customObj[propertyName]);
							}
						}
					}
				};
			// Bind base method to the CustomObject class
			CustomObject.prototype = base;
			// replace the original function with a new one expecting custom object as a parameter.
			extendCustomObject = function (customObj) {
				return new CustomObject(customObj);
			};
		},

		/**
		 * Breaks down an URL into it's three parts - protocol, host and the relative
		 *
		 * @param {String} urlString is any URL string
		 * @returns Object containing information about protocol, host and the relative chunk of the URL
		 * @type Object
		 * @private
		 */
		parseUrl = function parseUrl(urlString) {
			var domainRegExp = /^(https?:)\/\/([\w\d\.\-_%:@]+)\/?/,
				tempArray = urlString.replace(/^\s+/, '').replace(/\s+$/, '').split(domainRegExp),
				returnObj = {
					protocol: '',
					host: '',
					relative: tempArray[0]
				};
			if (tempArray.length === 4) {
				returnObj.protocol = tempArray[1];
				returnObj.host = tempArray[2];
				returnObj.relative = tempArray[3];
			}
			return returnObj;
		},

		/**
		 * Creates and returns a hidden iframe
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
			} else if (iframe.contentWindow) { // IE5.5 and IE6
				iframeDoc = iframe.contentWindow;
			}
			if (iframeDoc && iframeDoc.document) {
				iframeDoc = iframeDoc.document;
			}
			// return iframe node and its document object
			return {node: iframe, document: iframeDoc};
		},

		/**
		 * Create a specified HTML element with appropriate attributes.
		 *
		 * @param {Object} queueItem store all relevant information to create a node
		 * @returns node if the essential input values are correct or null in all other cases
		 * @type HTMLElement
		 * @private
		 */
		createNode = function createNode(queueItem) {
			var doc = document,
				node = NULL,
				src = queueItem.src,
				type = queueItem.type,
				content = queueItem.content,
				attributes = queueItem.attributes,
				attrArray = customAttributes[type],
				currentAttribute, currentValue, i;

			if (type === 'js') {
				// creates a script node
				node = doc.createElement('script');
				node.setAttribute('type', 'text/javascript');
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
			} else if (type === 'css') {
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
				node.setAttribute('type', 'text/css');
			}
			if (attributes && attrArray) {
				i = attrArray.length;
				while (i) {
					currentAttribute = attrArray[i - 1];
					currentValue = attributes[currentAttribute];
					if (currentValue !== undefined) {
						node.setAttribute(currentAttribute, currentValue);
					}
					i -= 1;
				}
			}
			return node;
		},

		/**
		 * Load the specified resources in parallel using xhr method
		 *
		 * @param {Object} queueItem store all relevant information to create a XHR connection
		 * @param {Function} callback (optional) callback function to execute when the resource is loaded
		 * @private
		 */
		xhrload = function xhrload(queueItem, callback) {
			var xhr,
				win = window,
				asyncTimeout;

			// test whether the XMLHttpRequest is defined and queueItem variable is an object
			if (XMLHttpRequest) {
				xhr = new XMLHttpRequest();
				queueItem.loadError = 2;
				// timeout for requests over an unreliable network
				asyncTimeout = win.setTimeout(function () {
					xhr.abort();
					callback(queueItem);
				}, queueItem.timeout);
				xhr.onreadystatechange = function () {
					var status = xhr.status;
					// readyState 4 menas complete
					if (xhr.readyState === 4) {
						win.clearTimeout(asyncTimeout);
						if (status >= 200 && status < 300 || status === 304) {
							queueItem.content = xhr.responseText;
							queueItem.loadError = 0;
						// something went wrong with XMLHttpRequest
						} else if (status === 0) {
							queueItem.loadError = 1;
						}
						callback(queueItem);
					}
				};
				xhr.open('GET', queueItem.src, TRUE);
				xhr.send(NULL);
			} else {
				// the XMLHttpRequest is not defined
				queueItem.loadError = 1;
				callback(queueItem);
			}
		},

		/**
		 * Handle the loading of an asset
		 *
		 * @param {Function} callback (optional) callback function to execute when the asset is loaded
		 * @returns updated method's owner object
		 * @type Object
		 * @private
		 */
		load = function load(callback) {
			var that = this;
			// try to load the asset using ajax
			if (this.ajax) {
				xhrload(this, function (queueItem) {
					// ajax call returns loadError equal to 1 when the assets are situated on a different server
					if (queueItem.loadError === 1 && !queueItem.hasOwnProperty('ajax')) {
						// in case the user doesn't set the ajax attribute try to load it again without using ajax
						queueItem.loadError = 0;
						queueItem.ajax = FALSE;
					}
					callback(queueItem);
				});
			// load the asset without using ajax
			} else {
				callback(that);
			}
			return this;
		},

		/**
		 * Choose the browser's native event handling method and return it for the next usage.
		 *
		 * @returns event handling method for actual browser
		 * @type Function
		 * @private
		 */
		addEventListener = (function () {
			if (typeof window.addEventListener === 'function') {
				return function addEventListener(queueItem, callback) {
					var currentNode = queueItem.node,
						iframeDocument;
					if (currentNode.node) {
						currentNode = currentNode.node;
						iframeDocument = currentNode.document;
					}
					// and create onload event
					currentNode.addEventListener('load', function XLLload() {
						var	isTypeCss = queueItem.type === 'css',
							loadedStyleSheet, rules;
						if (isTypeCss && iframeDocument) {
							loadedStyleSheet = iframeDocument.styleSheets[0];
							rules = loadedStyleSheet.cssRules;
							if (!rules || rules.length === 0) {
								queueItem.loadError = 3;
							}
						} else if (isTypeCss) {
							queueItem.loadError = 3;
						}
						callback(queueItem);
					}, FALSE);
					// in case of having problems with loading the linked file
					currentNode.addEventListener('error', function XLLerror() {
						queueItem.loadError = 3;
						callback(queueItem);
					}, FALSE);
				};
			} else if (window.attachEvent) {
				return function addEventListener(queueItem, callback) {
					var currentNode = queueItem.node;
					// onload event for IE, unfortunately the readyState is equal to loaded even in case of error occurrence
					currentNode.attachEvent('onreadystatechange', function () {
						var currentNode = queueItem.node,
							readyState = currentNode.readyState,
							loadedStyleSheet, rules;
						if (readyState === 'loaded' || readyState === 'complete') {
							currentNode.onreadystatechange = NULL;
							if (queueItem.type === 'css') {
								loadedStyleSheet = currentNode.styleSheet;
								rules = loadedStyleSheet.rules;
								if (!rules || rules.length === 0) {
									queueItem.loadError = 3;
								}
							}
							callback(queueItem);
						}
					});
				};
			} else {
				return undefined;
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
		injectToDOM = function injectToDOM(queueItemsArray, callback) {
			var win = window,
				doc = win.document,
				queueItemsArrayLen = queueItemsArray.length,
				itemsToProceed = queueItemsArrayLen,
				fragment = doc.createDocumentFragment(),
				fragmentInjected = FALSE,
				syncTimeout = [],
				iframeNode, iframeDocument, queueItem, currentNode, i,
				headElement = doc.getElementsByTagName('head')[0],
				bodyElement = doc.getElementsByTagName('body')[0],
				// function which is called after the node's injection
				onLoadComplete = function onLoadComplete(queueItem) {
					if (queueItem) {
						win.clearTimeout(syncTimeout[queueItem.index]);
						if (iframeDocument) {
							if (!queueItem.loadError) {
								queueItem.node = iframeDocument.getElementsByTagName('link')[0];
								headElement.appendChild(queueItem.node);
							} else {
								queueItem.node = NULL;
							}
							bodyElement.removeChild(iframeNode);
						}
						itemsToProceed -= 1;
					} else {
						
					}
					if (fragmentInjected && itemsToProceed === 0) {
						callback(queueItemsArray);
					}
				},
				onTimeout = function (queueItem) {
					return function onTimeout() {
						queueItem.loadError = TRUE;
						onLoadComplete(queueItem);
					};
				};

			for (i = 0; i < queueItemsArrayLen; i += 1) {
				queueItem = queueItemsArray[i];
				currentNode = createNode(queueItem);
				// after the period fires error event so the rest of the queue can be processed in case it's being held by event firing issue
				syncTimeout[queueItem.index] = win.setTimeout(onTimeout(queueItem), queueItem.timeout);
				// if the asset has been downloaded by ajax simply inject the node into the head of a page
				if (queueItem.ajax) {
					fragment.appendChild(currentNode);
					queueItem.node = currentNode;
					onLoadComplete(queueItem);
				// otherwise test the asset's type
				} else {
					// IE doesn't support addEventListener up to version 9
					if (queueItem.type === 'css' && win.addEventListener === 'function') {
						// if the type is css it is neccessary to create an iframe because link tag has no onload event by its own
						iframeNode = createIframe(bodyElement);
						queueItem.node = iframeNode;
						iframeDocument = iframeNode.document;
						iframeNode = iframeNode.node;
						// Inject the assets to the iframe
						iframeDocument.open();
						iframeDocument.getElementsByTagName('head')[0].appendChild(currentNode);
						iframeDocument.close();
						currentNode = iframeNode;
					// in case of js file or IE browser simply add the assets to the head of a page
					} else {
						fragment.appendChild(currentNode);
						queueItem.node = currentNode;
					}
					if (addEventListener) {
						addEventListener(queueItem, onLoadComplete);
					}
				}
			}
			headElement.appendChild(fragment);
			fragmentInjected = TRUE;
			onLoadComplete();
			//return this;
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
				queue = this.queue,
				src = queueItem.src,
				index = queue.length,
				currentUrl = window.location,
				currentDomain = currentUrl.protocol + currentUrl.host,
				parsedUrl, parsedDomain, ajax;

			if (src > '') {
				// set the actual index
				queueItem.index = index;
				if (!queueItem.hasOwnProperty('ajax')) {
					parsedUrl = parseUrl(src);
					parsedDomain = parsedUrl.protocol + parsedUrl.host;
					if (parsedDomain > '' && parsedDomain !== currentDomain) {
						queueItem.ajax = FALSE;
					}
				}
			} else {
				queueItem.ajax = FALSE;
			}
			ajax = queueItem.ajax;
			// push current item in the queue
			queue.push(queueItem);
			if (queueItem.fixOrder) {
				this.blockers.push(index);
			}
			if (!ajax || this.ajaxDownloads < this.ajaxDownloadsLimit) {
				if (ajax) {
					this.ajaxDownloads += 1;
				}
				queueItem.load(function ajaxLoad(queueItem) {
					var ajaxQueue = that.ajaxQueue;
					queueItem.processed = 1;
					if (queueItem.ajax) {
						that.queuePop(queueItem);
						if (ajaxQueue.length > 0) {
							queue[ajaxQueue.shift()].load(ajaxLoad);
						} else {
							that.ajaxDownloads -= 1;
						}
					}
				});
			} else {
				this.ajaxQueue.push(index);
			}
			return this;
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
				blockers = this.blockers,
				queue = this.queue,
				processQueue = [],
				i = this.lowerLimit,
				upperLimit = queue.length - 1,
				currentItem;
				
			if (blockers.length > 0) {
				upperLimit = blockers[0];
			}
			if (queueItem) {
				i = queueItem.index;
				if (upperLimit > i) {
					upperLimit = i;
				}
			}
			while (i <= upperLimit) {
				currentItem = queue[i];
				if (currentItem.processed === 1) {
					currentItem.processed = 2;
					processQueue.push(currentItem);
				}
				i += 1;
			}
			if (processQueue.length > 0) {
				injectToDOM(processQueue, function (queueItemsArray) {
					var globalQueue = that,
						queueLen = queueItemsArray.length,
						blockerResolved = FALSE,
						queueItem, i;
					for (i = 0; i < queueLen; i += 1) {
						queueItem = queueItemsArray[i];
						if (queueItem.loadError === 0) {
							if (queueItem.fixOrder) {
								blockers.shift();
								blockerResolved = TRUE;
							}
							queueItem.processed = 3;
							if ((globalQueue.lowerLimit + 1) === queueItem.index) {
								globalQueue.lowerLimit += 1;
							}
							queueItem.callback();
						} else {
							queueItem.error();
						}
					}
					if (blockerResolved) {
						globalQueue.queuePop();
					}
				});
			}
			return this;
		};

	// -- One-time init procedures ---------------------------------------------

	// bind the load method to the properties object
	customProperties.pvt.load = load;
	// first run of the extend custom object method which sets up default values and rewrite the function for a later use
	extendCustomObject(customProperties.pub, customProperties.pvt);
	globalQueue.queuePush = queuePush;
	globalQueue.queuePop = queuePop;

	// -- Public API -----------------------------------------------------------
	return {
		/**
		 * global API's load method starting the queuing process 
		 *
		 * @param {Object} options object with user's settings.
		 * @returns the application object to allow the chaining pattern.
		 * @type Object
		 * @public
		 */
		load: function load(options) {
			var queueItem;
			// extend user parameters object with default parameters, remove all unexpected values from the object
			if (typeof options === 'object') {
				queueItem = extendCustomObject(options);
				globalQueue.queuePush(queueItem);
				if (globalQueue.queue.length === 1) {
					window.setTimeout(function () {
						globalQueue.queuePop();
					}, 25);
				}
			}
			// return this makes the chaining works
			return this;
		},
		/**
		 * The exec is another global API's method which points to the load method.
		 * Basicaly it's just a new name, but the same functionality
		 * 
		 * @public
		 */
		exec: load
	};
}(this));
