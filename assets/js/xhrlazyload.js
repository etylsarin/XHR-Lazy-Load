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
		callback: myCallbackFunction //optional attribute, callback function evaluated if the loading proces is successful
		error: myErrorFunction //optional attribute, error function evaluated if the loading proces is unsuccessful
		})

*/

var $XLL = (function () {

	// -- Private Variables --------------------------------------------------------
	var queue = [],
		queueProcessIndex = 0,
		// define the default options attributes
		optionsProperties = ['src', 'type', 'fixOrder', 'ajax', 'callback', 'error'],
		// define the default options values
		optionsDefaults = {
			type: 'js',
			fixOrder: false,
			ajax: true,
			loadError: -1,
			processed: -1
		},
		// find out whether the XMLHttpRequest method is defined for actual browser. If not, try to find propriate one.
		XMLHttpRequest = (function () {
			if (typeof window.XMLHttpRequest !== 'undefined') {
				return function () {
					return new window.XMLHttpRequest();
				};
			} else if (typeof window.ActiveXObject !== 'undefined') {
				return function () {
					return new window.ActiveXObject('Microsoft.XMLHTTP');
				};
			} else {
				return function () {
					return false;
				};
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
				returnObj = {},
				objLength = 0,
				i = 0;
			if (typeof prototypeObj === 'object') {
				TempObj.prototype = prototypeObj;
				returnObj = new TempObj();
			}
			if ((typeof obj === 'object') && (typeof propertiesArray === 'object')) {
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
				node = null,
				attr = null,
				returnValue = false;

			if ((typeof options === 'object') && (typeof options.type === 'string') && ((typeof options.src === 'string') || (typeof options.content === 'string'))) {
				switch (options.type) {
				case 'js':
					// creates a script node
					node = d.createElement('script');
					node.setAttribute('type', 'text/javascript');
					if ((options.ajax === false) && (typeof options.src === 'string')) {
						node.setAttribute('src', options.src);
						returnValue = node;
					} else if (typeof options.content === 'string') {
						//IE can't append node to the script element
						if ((typeof node.canHaveChildren === 'undefined') || (node.canHaveChildren === true)) {
							node.appendChild(d.createTextNode(options.content));
						} else {
							node.text = options.content;
						}
						returnValue = node;
					}
					break;
				case 'css':
					// creates a link (stylesheet) node
					if ((options.ajax === false) && (typeof options.src === 'string')) {
						node = d.createElement('link');
						node.setAttribute('media', 'all');
						node.setAttribute('type', 'text/css');
						node.setAttribute('rel', 'stylesheet');
						node.setAttribute('href', options.src);
						returnValue = node;
					} else if (typeof options.content === 'string') {
						node = d.createElement('style');
						node.setAttribute('type', 'text/css');
						//IE can't append node to the style element
						if (typeof node.styleSheet === 'undefined') {
							node.appendChild(d.createTextNode(options.content));
						} else {
							node.styleSheet.cssText = d.createTextNode(options.content);
						}
						returnValue = node;
					}
					break;
				}
			}
			return returnValue;
		},

		/**
		 * Creates and returns a hidden iframe and injects passed content into it.
		 *
		 * @method createIframe
		 * @param {HTMLElement} headContent store an element to inject into the iframe head
		 * @param {HTMLElement} bodyContent store an element to inject into the iframe body
		 * @return {Object}
		 * @private
		 */
		createIframe = function createIframe(injectToHead, injectToBody) {
			var iframe = document.createElement("iframe"),
				d = null;

			// set iframe as a non-displayed element to avoid repaints and reflows
			iframe.style.display = 'none';
			document.body.appendChild(iframe);
			d = iframe.document;
			if (iframe.contentDocument) { // modern browsers
				d = iframe.contentDocument;
			} else if (iframe.contentWindow) { // IE5.5 and IE6
				d = iframe.contentWindow.document;
			}
			// Inject the content in the iframe
			d.open();
			if (typeof injectToHead === 'object') {
				d.getElementsByTagName('head')[0].appendChild(injectToHead);
			}
			if (typeof injectToBody === 'object') {
				d.getElementsByTagName('body')[0].appendChild(injectToBody);
			}
			d.close();
			// return iframe node and its document object
			return {iframe: iframe, iframeDocument: d};
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
			var xhr = null;

			// test whether the XMLHttpRequest is defined and options variable is an object
			if ((typeof XMLHttpRequest === 'function') && (typeof options === 'object')) {
				xhr = new XMLHttpRequest();
				options.loadError = 2;
				xhr.onreadystatechange = function () {
					// readyState 4 menas complete
					if (xhr.readyState === 4) {
						if ((xhr.status >= 200) && (xhr.status < 300) || (xhr.status === 304)) {
							options.content = xhr.responseText;
							options.loadError = 0;
						} else if (xhr.status === 0) {
							options.loadError = 1;
						}
						if (typeof callback === 'function') {
							callback(options);
						}
					}
				};
				xhr.open('GET', options.src, true);
				xhr.send(null);
			} else {
				// test if the options variable is an object
				if (typeof options !== 'object') {
					options = {};
					options.loadError = 2;
				// otherwise the XMLHttpRequest is not defined
				} else {
					options.loadError = 1;
				}
				if (typeof callback === 'function') {
					callback(options);
				}
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
				isLoaded = false,
				errorOccured = false,
				d = document,
				headElement = d.getElementsByTagName('head')[0],
				bodyElement = d.getElementsByTagName('body')[0],
				// function which is called after the node's injection
				onLoadComplete = function onLoadComplete(currentNode, currentOptions, callback) {
					if ((currentNode.iframe !== undefined) && (currentNode.iframeDocument !== undefined)) {
						headElement.appendChild(currentNode.iframeDocument.getElementsByTagName('link')[0]);
						bodyElement.removeChild(currentNode.iframe);
					}
					isLoaded = true;
					if (errorOccured === false) {
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
					// call the callback parameter
					if (typeof callback === 'function') {
						callback(errorOccured);
					}
				};

			// if the asset has been downloaded by ajax simply inject the node into the page
			if (currentOptions.ajax) {
				headElement.appendChild(currentNode);
				onLoadComplete(currentNode, currentOptions, callback);
			// otherwise test the asset's type
			} else {
				if (currentOptions.type === 'js') {
					// insert the script link
					headElement.appendChild(currentNode);
				} else if (currentOptions.type === 'css') {
					// if the type is css it is neccessary to create an iframe because link tag has no onload event by its own
					currentNode = createIframe(currentNode);
				}
				// and create onload event
				currentNode.onload = function () {
					if (!isLoaded) {
						onLoadComplete(currentNode, currentOptions, callback);
					}
				};
				// and onload event for IE
				currentNode.onreadystatechange = function () {
					if (!isLoaded && ((currentNode.readyState === 'loaded') || (currentNode.readyState === 'complete'))) {
						onLoadComplete(currentNode, currentOptions, callback);
					}
				};
				// in case of aving problems with loading the linked file
				currentNode.onerror = function () {
					errorOccured = true;
					onLoadComplete(currentNode, currentOptions, callback);
				};
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
				currentQueueItem = null,
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
							// define a callback of the inject function
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
				if (currentOptions.ajax === true) {
					xhrload(currentOptions, function (currentOptions) {
						// ajax call returns loadError equal to 1 when the assets are situated on a different server
						if (currentOptions.loadError === 1) {
							// in that case try to load it again without using ajax
							currentOptions.loadError = 0;
							currentOptions.ajax = false;
						}
						if (currentOptions.loadError === 0) {
							dequeue(currentQueue, queueProcessIndex);
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
