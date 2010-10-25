/**
 * @fileOverview xhr lazy loading
 * @version 0.2 (18-JUL-2010)
 * @author Filip Mares - http:// www.filip-mares.co.uk/
 *
 * Dual licensed under the MIT and GPL licenses:
 * http:// www.opensource.org/licenses/mit-license.php
 * http:// www.gnu.org/licenses/gpl.html
*/

/*jslint eqeqeq: true, undef: true */
/*global window, document */

/*
Usage Note:
-----------
Here is an example how to use xhr lazy loading, parameters and their values are optional except 'src'

	$XLL.load({
		src: 'myScript.js', //required attribute, source file to be lazy loaded
		type: 'js', //optional attribute, 'js' by default, other possible value is 'css'
		fixOrder: true, //optional attribute, false by default, when set to true loading order of the related file is preserved
		ajax: false, //optional attribute, true by default, decides if the source file is loaded by xhr
		attributes: {id: 'myFile'}, //optional attribute, undefined by default, allows user to add specific attributes to assets
		// allowed attributes for script tag: id
		// allowed attributes for link or style tag: id, media, title
		timeout: 5000, //optional attribute, 5 seconds by default, after the period fires error event so the rest of the queue can be processed
		callback: myCallbackFunction //optional attribute, callback function evaluated if the loading proces is successful
		error: myErrorFunction //optional attribute, error function evaluated if the loading proces is unsuccessful
		})
*/

var $XLL = (function () {

	// -- Private Variables --------------------------------------------------------
	var queue = [],
		queueProcessIndex = 0,
		// define the default options attributes
		optionsProperties = ['src', 'type', 'fixOrder', 'ajax', 'attributes', 'timeout', 'callback', 'error'],
		// define the default options values
		optionsDefaults = {
			type: 'js',
			fixOrder: false,
			ajax: true,
			timeout: 5000,
			loadError: -1,
			processed: -1
		},
		jsAttributes = ['id'],
		cssAttributes = ['id', 'media', 'title'],
		// find out whether the XMLHttpRequest method is defined for actual browser. If not, try to use browser specific one.
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

	// -- Private Methods --------------------------------------------------------

		/**
		 * Creates extended object with a specified prototype object, uses properties only defined in passed array
		 *
		 * @method extendObject
		 * @param {Object} obj object which should be extended
		 * @param {Object} prototypeObj which should be used as a prototype of the extended object
		 * @param {Array} propertiesArray Array which defines properties which should be included in returned object
		 * @return {Object} returnObj contains all properties from prototype object and properties from the obj object specified in the propertiesArray
		 * @private
		 */
		extendObject = function extendObject(obj, prototypeObj, propertiesArray) {
			var TempObj = function () {},
				returnObj, objLength, i;

			TempObj.prototype = prototypeObj;
			returnObj = new TempObj();
			if (typeof obj === 'object') {
				objLength = propertiesArray.length;
				for (i = objLength; i--;) {
					if (obj[propertiesArray[i]] !== undefined) {
						returnObj[propertiesArray[i]] = obj[propertiesArray[i]];
					}
				}
			}
			return returnObj;
		},

		/**
		 * Creates and returns an specified HTML element with appropriate attributes.
		 *
		 * @method createNode
		 * @param {Object} options store all informations for creating a node
		 * @return {HTMLElement} if all essential input values are correct or false if some essential input value is missing
		 * @private
		 */
		createNode = function createNode(options) {
			var d = document,
				node,
				addCustomAttributes = function addCustomAttributes(currentNode, attributes, filterArray) {
					var len = filterArray.length,
						i = 0,
						currentAttribute = null;
					if (typeof attributes === 'object') {
						for (i = len; i--;) {
							currentAttribute = attributes[filterArray[i]];
							if (currentAttribute !== undefined) {
								currentNode.setAttribute(filterArray[i], currentAttribute);
							}
						}
					}
				};

			if ((typeof options.src === 'string') || (typeof options.content === 'string')) {
				switch (options.type) {
				case 'js':
					// creates a script node
					node = d.createElement('script');
					node.setAttribute('type', 'text/javascript');
					addCustomAttributes(node, options.attributes, jsAttributes);
					if (typeof options.content === 'string') {
						//IE can't append node to the script element
						if (node.canHaveChildren !== false) {
							node.appendChild(d.createTextNode(options.content));
						} else {
							node.text = options.content;
						}
					} else {
						node.setAttribute('src', options.src);
					}
					break;
				case 'css':
					// creates a link (stylesheet) node
					if (typeof options.content === 'string') {
						node = d.createElement('style');
						//IE can't append node to the style element
						if (node.styleSheet === undefined) {
							node.appendChild(d.createTextNode(options.content));
						} else {
							node.styleSheet.cssText = options.content;
						}
					} else {
						node = d.createElement('link');
						node.setAttribute('rel', 'stylesheet');
						node.setAttribute('href', options.src);
					}
					node.setAttribute('type', 'text/css');
					addCustomAttributes(node, options.attributes, cssAttributes);
					break;
				}
			}
			return node;
		},

		/**
		 * Creates and returns a hidden iframe.
		 *
		 * @method createIframe
		 * @param {HTMLElement} headContent store an element to inject into the iframe head
		 * @param {HTMLElement} bodyContent store an element to inject into the iframe body
		 * @return {Object}
		 * @private
		 */
		createIframe = function createIframe(parentElement) {
			var iframe = document.createElement('iframe'),
				d;

			// set iframe as a non-displayed element to avoid repaints and reflows
			iframe.style.display = 'none';
			parentElement.appendChild(iframe);
			if (iframe.contentDocument !== undefined) { // modern browsers
				d = iframe.contentDocument;
			} else if (iframe.contentWindow !== undefined) { // IE5.5 and IE6
				d = iframe.contentWindow;
			}
			if (d.document !== undefined) {
				d = d.document;
			}
			// return iframe node and its document object
			return {iframeNode: iframe, iframeDocument: d};
		},

		/**
		 * Loads the specified resources in parallel using xhr method
		 *
		 * @method xhrload
		 * @param {Object} options object to pass to the settings
		 * @param {Function} callback (optional) callback function to execute when the
		 * resource is loaded
		 * @private
		 */
		xhrload = function xhrload(options, callback) {
			var xhr, asyncTimeout;

			// test whether the XMLHttpRequest is defined and options variable is an object
			if (typeof XMLHttpRequest === 'function') {
				xhr = new XMLHttpRequest();
				options.loadError = 2;
				// timeout for requests over an unreliable network
				asyncTimeout = window.setTimeout(function () {
					xhr.abort();
					callback(options);
				}, options.timeout);
				xhr.onreadystatechange = function () {
					// readyState 4 menas complete
					if (xhr.readyState === 4) {
						window.clearTimeout(asyncTimeout);
						if ((xhr.status >= 200) && (xhr.status < 300) || (xhr.status === 304)) {
							options.content = xhr.responseText;
							options.loadError = 0;
						// something went wrong with XMLHttpRequest
						} else if (xhr.status === 0) {
							options.loadError = 1;
						}
						callback(options);
					}
				};
				xhr.open('GET', options.src, true);
				xhr.send(null);
			} else {
				// the XMLHttpRequest is not defined
				options.loadError = 1;
				callback(options);
			}
		},

		/**
		 * Injects a node into the page and call the callback function
		 *
		 * @method injectToDOM
		 * @param {Object} currentOptions object to pass to the settings
		 * @param {Function} callback (optional) callback function to execute when the
		 * resource is loaded
		 * @private
		 */
		injectToDOM = function injectToDOM(currentOptions, callback) {
			var currentNode = createNode(currentOptions),
				iframeNode, iframeDocument, syncTimeout,
				isLoaded = false,
				errorOccured = false,
				d = document,
				headElement = d.getElementsByTagName('head')[0],
				bodyElement = d.getElementsByTagName('body')[0],
				// function which is called after the node's injection
				onLoadComplete = function onLoadComplete(currentNode, currentOptions, callback) {
					window.clearTimeout(syncTimeout);
					isLoaded = true;
					if (errorOccured === false) {
						if (iframeDocument !== undefined) {
							headElement.appendChild(iframeDocument.getElementsByTagName('link')[0]);
						}
						// when no error occured call the users callback
						if (typeof currentOptions.callback === 'function') {
							currentOptions.callback(currentOptions);
						}
					} else {
						// when error occured call the users error callback
						if (typeof currentOptions.error === 'function') {
							currentOptions.error(currentOptions);
						}
					}
					if (iframeNode !== undefined) {
						bodyElement.removeChild(iframeNode);
					}
					// call the function's callback
					callback(errorOccured);
				};

			if (currentNode !== undefined) {
				// after the period fires error event so the rest of the queue can be processed in case it's being held by event firing issue
				syncTimeout = window.setTimeout(function () {
					errorOccured = true;
					onLoadComplete(currentNode, currentOptions, callback);
				}, currentOptions.timeout);
				// if the asset has been downloaded by ajax simply inject the node into the head of a page
				if (currentOptions.ajax) {
					headElement.appendChild(currentNode);
					onLoadComplete(currentNode, currentOptions, callback);
				// otherwise test the asset's type
				} else {
					// IE doesn't support addEventListener up to version 9
					if ((currentOptions.type === 'css') && (typeof window.addEventListener === 'function')) {
						// if the type is css it is neccessary to create an iframe because link tag has no onload event by its own
						iframeNode = createIframe(bodyElement);
						iframeDocument = iframeNode.iframeDocument;
						iframeNode = iframeNode.iframeNode;
						// Inject the assets to the iframe
						iframeDocument.open();
						iframeDocument.getElementsByTagName('head')[0].appendChild(currentNode);
						iframeDocument.close();
						currentNode = iframeNode;
					// in case of js file or IE browser simply add the assets to the head of a page
					} else {
						headElement.appendChild(currentNode);
					}
					// IE doesn't support addEventListener up to version 9
					if (typeof window.addEventListener === 'function') {
						// and create onload event
						currentNode.addEventListener('load', function XLLload() {
							var loadedStyleSheet = null;
							if (!isLoaded) {
								if ((currentOptions.type === 'css') && (iframeDocument !== undefined)) {
									loadedStyleSheet = iframeDocument.styleSheets[0];
									if ((loadedStyleSheet.cssRules === undefined) || (loadedStyleSheet.cssRules.length === 0)) {
										errorOccured = true;
									}
								} else if (currentOptions.type === 'css') {
									errorOccured = true;
								}
								onLoadComplete(currentNode, currentOptions, callback);
							}
						}, false);
						// in case of having problems with loading the linked file
						currentNode.addEventListener('error', function XLLerror() {
							errorOccured = true;
							onLoadComplete(currentNode, currentOptions, callback);
						}, false);
					}
					// onload event for IE, unfortunately the readyState is equal to loaded even in case of error occurrence
					if (typeof currentNode.attachEvent === 'object') {
						currentNode.attachEvent('onreadystatechange', function () {
							var loadedStyleSheet = null;
							if (!isLoaded && ((currentNode.readyState === 'loaded') || (currentNode.readyState === 'complete'))) {
								if (currentOptions.type === 'css') {
									loadedStyleSheet = currentNode.styleSheet;
									if ((loadedStyleSheet.rules === undefined) || (loadedStyleSheet.rules.length === 0)) {
										errorOccured = true;
									}
								}
								onLoadComplete(currentNode, currentOptions, callback);
							}
						});
					}
				}
			}
		},

		/**
		 * Loop through the queue trying to find downloaded parts and inject them into the page
		 *
		 * @method dequeue
		 * @param {Array} currentQueue array to pass the queue to be loaded
		 * @param {Number} currentQueueProcessIndex index of the first unresolved item in the queue
		 * @private
		 */
		dequeue = function dequeue(currentQueue, currentQueueProcessIndex) {
			var currentQueueLength = currentQueue.length,
				currentQueueItem,
				blocked = false,
				i = currentQueueProcessIndex;

			// loop through the queue while the dequeue process was not blocked
			while ((!blocked) && (i < currentQueueLength)) {
				currentQueueItem = currentQueue[i];
				// test whether the current item blocking loading of the rest of the queue
				if ((currentQueueItem.fixOrder) && (currentQueueItem.processed < 1)) {
					blocked = true;
				}
				// test whether the proces is not blocked, item is loaded without errors, is not being processed
				if (((!blocked) || (i === currentQueueProcessIndex)) && (currentQueueItem.processed === -1)) {
					if (currentQueueItem.loadError === 0) {
						currentQueueItem.processed = 0;
						// call the function which injects the actual asset into the DOM
						injectToDOM(currentQueueItem, function (errorOccured) {
							// define a callback of the node inject function
							if (errorOccured === false) {
								var currentQueueProcessIndex = queueProcessIndex;
								currentQueueItem.processed = 1;
								if (currentQueueProcessIndex === currentQueueItem.index) {
									currentQueueProcessIndex = currentQueueProcessIndex + 1;
									queueProcessIndex = currentQueueProcessIndex;
								}
								if (currentQueue.length > currentQueueProcessIndex) {
									dequeue(currentQueue, currentQueueProcessIndex);
								}
							} else {
								currentQueueItem.loadError = 2;
							}
						});
					}
				} else if ((currentQueueItem.processed === 1) && (currentQueueItem.index === currentQueueProcessIndex)) {
					currentQueueProcessIndex = currentQueueProcessIndex + 1;
					queueProcessIndex = currentQueueProcessIndex;
				}
				currentQueue[i] = currentQueueItem;
				i = i + 1;
			}
		};

	// -- Public Methods --------------------------------------------------------
	return {
		// load method
		load: function load(options) {
			// extend user parameters object with default parameters, remove all unexpected values from the object
			var currentOptions = extendObject(options, optionsDefaults, optionsProperties),
				currentQueue = queue;

			// test whether the src attribute is defined and contains non-empty string
			if ((typeof currentOptions.src === 'string') && (currentOptions.src > '')) {
				// set the index of the actual queued item
				currentOptions.index = currentQueue.length;
				// push current item in the queue
				currentQueue.push(currentOptions);
				// try to load the asset using ajax
				if (currentOptions.ajax) {
					xhrload(currentOptions, function (currentOptions) {
						// ajax call returns loadError equal to 1 when the assets are situated on a different server
						if ((currentOptions.loadError === 1) && (currentOptions.hasOwnProperty('ajax') === false)) {
							// in case the user doesn't set the ajax attribute try to load it again without using ajax
							currentOptions.loadError = 0;
							currentOptions.ajax = false;
						}
						if (currentOptions.loadError === 0) {
							dequeue(currentQueue, queueProcessIndex);
						}
						// when error occured call the users error callback
						if ((currentOptions.loadError > 0) && (typeof currentOptions.error === 'function')) {
							currentOptions.error(currentOptions);
						}
					});
				// load the asset without using ajax
				} else {
					currentOptions.loadError = 0;
					dequeue(currentQueue, queueProcessIndex);
				}
			}
			// return this makes the chaining works
			return this;
		}
	};
}());
