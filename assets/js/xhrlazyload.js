/**
 * @fileOverview xhr lazy loading
 * @version 0.3.0 (01-FEB-2011)
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

var $XLL = (function (window, undefined) {

	// -- Private Variables --------------------------------------------------------
	var TRUE = true,
		FALSE = false,
		NULL = null,
		OBJECT = 'object',
		FUNCTION = 'function',
		STRING = 'string',
		document = window.document,
		queue = [],
		queueProcessIndex = 0,
		// define the default options attributes
		optionsProperties = ['src', 'type', 'fixOrder', 'ajax', 'attributes', 'timeout', 'callback', 'error'],
		// define the default options values
		optionsDefaults = ['', 'js', FALSE, TRUE, {}, 5000],
		// define 
		jsAttributes = ['id'],
		cssAttributes = ['id', 'media', 'title'],
		// find out whether the XMLHttpRequest method is defined for actual browser. If not, try to use browser specific one.
		XMLHttpRequest = (function () {
			if (typeof window.XMLHttpRequest === FUNCTION) {
				return function () {
					return new window.XMLHttpRequest();
				};
			} else if (typeof window.ActiveXObject === FUNCTION) {
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
		extendObject = function extendObject(customObj, propertiesArray, valuesArray) {
			var TempObj = function () {},
				prototypeObj = {},
				returnObj, length, i, defaultProperty, currentProperty;

			length = propertiesArray.length;
			for (i = length; i--;) {
				prototypeObj[propertiesArray[i]] = valuesArray[i];
			}
			TempObj.prototype = prototypeObj;
			returnObj = new TempObj();
			if (typeof customObj === OBJECT) {
				for (i = length; i--;) {
					currentProperty = customObj[propertiesArray[i]];
					defaultProperty = returnObj[propertiesArray[i]];
					if (typeof currentProperty === typeof defaultProperty || typeof currentProperty === FUNCTION) {
						defaultProperty = currentProperty;
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
			var doc = document,
				node,
				src = options.src,
				type = options.type,
				content = options.content,
				attributes = options.attributes,
				addCustomAttributes = function addCustomAttributes(currentNode, attributes, filterArray) {
					var i, currentAttribute;
					if (typeof attributes === OBJECT) {
						i = filterArray.length;
						while (i--) {
							currentAttribute = attributes[filterArray[i]];
							if (currentAttribute !== undefined) {
								currentNode.setAttribute(filterArray[i], currentAttribute);
							}
						}
					}
				};

			if (((typeof src === STRING) || (typeof content === STRING)) && ((type === 'js') || (type === 'css'))) {
				if (type === 'js') {
					// creates a script node
					node = doc.createElement('script');
					node.setAttribute('type', 'text/javascript');
					addCustomAttributes(node, attributes, jsAttributes);
					if (typeof content === STRING) {
						//IE can't append node to the script element
						if (node.canHaveChildren !== FALSE) {
							node.appendChild(doc.createTextNode(content));
						} else {
							node.text = content;
						}
					} else {
						node.setAttribute('src', src);
					}
				} else {
					// creates a link (stylesheet) node
					if (typeof content === STRING) {
						node = doc.createElement('style');
						//IE can't append node to the style element
						if (node.styleSheet === undefined) {
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
					addCustomAttributes(node, attributes, cssAttributes);
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
				doc;

			// set iframe as a non-displayed element to avoid repaints and reflows
			iframe.style.display = 'none';
			parentElement.appendChild(iframe);
			if (iframe.contentDocument !== undefined) { // modern browsers
				doc = iframe.contentDocument;
			} else if (iframe.contentWindow !== undefined) { // IE5.5 and IE6
				doc = iframe.contentWindow;
			}
			if (doc.document !== undefined) {
				doc = doc.document;
			}
			// return iframe node and its document object
			return {iframeNode: iframe, iframeDocument: doc};
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
			var xhr, asyncTimeout,
				win = window;

			// test whether the XMLHttpRequest is defined and options variable is an object
			if (typeof XMLHttpRequest === FUNCTION) {
				xhr = new XMLHttpRequest();
				options.loadError = 2;
				// timeout for requests over an unreliable network
				asyncTimeout = win.setTimeout(function () {
					xhr.abort();
					callback(options);
				}, options.timeout);
				xhr.onreadystatechange = function () {
					var status = xhr.status;
					// readyState 4 menas complete
					if (xhr.readyState === 4) {
						win.clearTimeout(asyncTimeout);
						if ((status >= 200) && (status < 300) || (status === 304)) {
							options.content = xhr.responseText;
							options.loadError = 0;
						// something went wrong with XMLHttpRequest
						} else if (status === 0) {
							options.loadError = 1;
						}
						callback(options);
					}
				};
				xhr.open('GET', options.src, TRUE);
				xhr.send(NULL);
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
		 * @param {Object} options object to pass to the settings
		 * @param {Function} callback (optional) callback function to execute when the
		 * resource is loaded
		 * @private
		 */
		injectToDOM = function injectToDOM(options, callback) {
			var currentNode = createNode(options),
				iframeNode, iframeDocument, syncTimeout,
				type = options.type,
				isLoaded = FALSE,
				errorOccured = FALSE,
				win = window,
				doc = document,
				headElement = doc.getElementsByTagName('head')[0],
				bodyElement = doc.getElementsByTagName('body')[0],
				// function which is called after the node's injection
				onLoadComplete = function onLoadComplete(currentNode, options, internalCallback) {
					var callback = options.callback,
						error = options.error;
					win.clearTimeout(syncTimeout);
					isLoaded = TRUE;
					if (errorOccured === FALSE) {
						if (iframeDocument !== undefined) {
							headElement.appendChild(iframeDocument.getElementsByTagName('link')[0]);
						}
						// when no error occured call the users callback
						if (typeof callback === FUNCTION) {
							callback(options);
						}
					} else {
						// when error occured call the users error callback
						if (typeof error === FUNCTION) {
							error(options);
						}
					}
					if (iframeNode !== undefined) {
						bodyElement.removeChild(iframeNode);
					}
					// call the function's callback
					internalCallback(errorOccured);
				};

			if (currentNode !== undefined) {
				// after the period fires error event so the rest of the queue can be processed in case it's being held by event firing issue
				syncTimeout = win.setTimeout(function () {
					errorOccured = TRUE;
					onLoadComplete(currentNode, options, callback);
				}, options.timeout);
				// if the asset has been downloaded by ajax simply inject the node into the head of a page
				if (options.ajax) {
					headElement.appendChild(currentNode);
					onLoadComplete(currentNode, options, callback);
				// otherwise test the asset's type
				} else {
					// IE doesn't support addEventListener up to version 9
					if ((type === 'css') && (typeof win.addEventListener === FUNCTION)) {
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
					if (typeof win.addEventListener === FUNCTION) {
						// and create onload event
						currentNode.addEventListener('load', function XLLload() {
							var loadedStyleSheet, rules;
							if (!isLoaded) {
								if ((type === 'css') && (iframeDocument !== undefined)) {
									loadedStyleSheet = iframeDocument.styleSheets[0];
									rules = loadedStyleSheet.cssRules;
									if ((rules === undefined) || (rules.length === 0)) {
										errorOccured = TRUE;
									}
								} else if (type === 'css') {
									errorOccured = TRUE;
								}
								onLoadComplete(currentNode, options, callback);
							}
						}, FALSE);
						// in case of having problems with loading the linked file
						currentNode.addEventListener('error', function XLLerror() {
							errorOccured = TRUE;
							onLoadComplete(currentNode, options, callback);
						}, FALSE);
					}
					// onload event for IE, unfortunately the readyState is equal to loaded even in case of error occurrence
					if (typeof currentNode.attachEvent === OBJECT) {
						currentNode.attachEvent('onreadystatechange', function () {
							var loadedStyleSheet, rules;
							if (!isLoaded && ((currentNode.readyState === 'loaded') || (currentNode.readyState === 'complete'))) {
								if (type === 'css') {
									loadedStyleSheet = currentNode.styleSheet;
									rules = loadedStyleSheet.rules;
									if ((rules === undefined) || (rules.length === 0)) {
										errorOccured = TRUE;
									}
								}
								onLoadComplete(currentNode, options, callback);
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
			var currentQueueItem, processed,
				blocked = FALSE,
				len = currentQueue.length,
				i = currentQueueProcessIndex;

			// loop through the queue while the dequeue process was not blocked
			while ((!blocked) && (i < len)) {
				currentQueueItem = currentQueue[i];
				processed = currentQueueItem.processed;
				// test whether the current item blocking loading of the rest of the queue
				if ((currentQueueItem.fixOrder) && (processed < 1)) {
					blocked = TRUE;
				}
				// test whether the proces is not blocked, item is loaded without errors, is not being processed
				if (((!blocked) || (i === currentQueueProcessIndex)) && (processed === -1)) {
					if (currentQueueItem.loadError === 0) {
						currentQueueItem.processed = 0;
						// call the function which injects the actual asset into the DOM
						injectToDOM(currentQueueItem, function (errorOccured) {
							// define a callback of the node inject function
							if (errorOccured === FALSE) {
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
				} else if ((processed === 1) && (currentQueueItem.index === currentQueueProcessIndex)) {
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
			var currentOptions = extendObject(options, optionsProperties, optionsDefaults),
				src = currentOptions.src,
				currentQueue = queue;

			// test whether the src attribute is defined and contains non-empty string
			if ((typeof src === STRING) && (src > '')) {
				// set the index of the actual queued item
				currentOptions.loadError = -1;
				currentOptions.processed = -1;
				currentOptions.index = currentQueue.length;
				// push current item in the queue
				currentQueue.push(currentOptions);
				// try to load the asset using ajax
				if (currentOptions.ajax) {
					xhrload(currentOptions, function (currentOptions) {
						var loadError = currentOptions.loadError,
							error = currentOptions.error;
						// ajax call returns loadError equal to 1 when the assets are situated on a different server
						if ((loadError === 1) && (currentOptions.hasOwnProperty('ajax') === FALSE)) {
							// in case the user doesn't set the ajax attribute try to load it again without using ajax
							loadError = 0;
							currentOptions.loadError = 0;
							currentOptions.ajax = FALSE;
						}
						if (loadError === 0) {
							dequeue(currentQueue, queueProcessIndex);
						} else if (typeof error === FUNCTION) {
							// when error occured call the users error callback
							error(currentOptions);
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
}(this));
