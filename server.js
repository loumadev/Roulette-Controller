
const http = require('http');
const path = require('path');
const util = require("util");
const url = require('url');
const fs = require('fs');
const {EventListenerStatic, EventListener, fixDigits, iterate, getQueryParameters} = require("./JustLib.js");
const {CLI, KEY} = require("./CLI");

const btoa = data => Buffer.from(data).toString("base64");
const atob = data => Buffer.from(data, "base64").toString();

const PATH = {
	CONFIG: __dirname + "/config.json",
	TRUSTED_IPS: __dirname + "/trustedips.json",
	BLACKLIST: __dirname + "/blacklist.json",
	MODULES: __dirname + "/modules/",
	PUBLIC: __dirname + "/public/"
};

class Server extends EventListenerStatic {
	static title = null;
	static modules = {};
	/**
	 * Server standard input/output
	 * @static
	 * @type {{cli: CLI, settings: {logs: Boolean, warnings: Boolean, errors: Boolean}}} obj1
	 * @memberof Server
	 */
	static stdio = {
		cli: null,
		settings: {
			logs: true,
			warnings: true,
			errors: true
		}
	};

	static TRUSTED_IPS = [];
	static BLACKLIST = [];
	static PATH = PATH;

	static begin() {
		/**
		 * @type {
				((event: string, listener: (event: RequestEvent) => void) => EventListener.Listener) &
				((event: 'request', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
				((event: 'load', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
				((event: 'unload', listener: (event: EventListener.Event) => void) => EventListener.Listener)
			}
		 */
		this.on;


		//Set up error logging
		process.on('unhandledRejection', (reason, promise) => {
			this.error("Unhandled Promise Rejection at:", promise);
		});

		var startDate = new Date();
		this.log("§7Starting initialisation...");

		//Config
		this.log("§7Loading properties...");
		this._loadConfig();
		this._loadTrustedIPs();
		this._loadBlacklist();
		this.log("§7Properties loaded");

		//CLI
		if(this.config["enable-cli"]) {
			this.log("§7Enabling CLI...");
			this.stdio.cli = new CLI(process);
			this.stdio.cli.begin();

			//Handle default commands
			this.stdio.cli.on("command", async e => {
				const {input, command, args} = e;

				if(command == "stop") {
					this.stop();
				} else if(command == "help") {
					this.log("§eCommands:\n§bStop §f- §aStop server\n§bHelp §f- §aShow this menu");
				} else if(command == "clear") {
					console.clear();
				} else if(command == "eval") {
					try {
						e.preventDefault();
						this.log(util.formatWithOptions({colors: true}, "< %O", await eval(args.join(" "))));
					} catch(e) {
						this.log(`[EVAL ERROR]: ` + (e?.message || `Unknown error (${e?.message})`));
					}
				} else if(command == "") {
					;
				} else return;

				e.preventDefault();
			});

			//Unknown command handler
			this.stdio.cli.on("unknownCommand", ({input} = e) => {
				this.log("§cUnknow command. Write \"help\" for help.");
			});

			/*fs.writeFileSync("stdout.log", "");
			this.stdio.cli.on("stdout", ({string} = e) => {
				fs.appendFileSync("stdout.log", string);
			});*/
			this.log("§7CLI enabled");
		} else this.log(`§7CLI disabled`);

		//Init
		if(!this.title) this.setTitle();

		//HTTP Server
		this.log("§7Creating HTTP server...");
		if(!fs.existsSync(PATH.PUBLIC)) {
			this.log(`§7Creating new empty §fpublic §7folder...`);
			fs.mkdirSync(PATH.PUBLIC);
		}
		this.http = http.createServer((req, res) => this._handleRequest(req, res));
		this.http.on("error", err => {
			this.error(err.message);
		});
		this.log(`§7HTTP server created`);

		//Modules
		this._loadModules();

		//Load event
		this.log("§7Loading server...");
		this.dispatchEvent("load");
		this.log("§7Server loaded");

		//HTTP listen
		this.http.listen(this.config["http-port"]);
		this.http.on("listening", e => {
			this.log("§7Server listen on port §f" + this.config["http-port"]);
			this.log(`§7Initialisation done (§ftook ${new Date() - startDate}ms§7)`);
		});
	}

	static stop(code = 0) {
		this.log("§cStoping server...");
		this.dispatchEvent("unload");
		process.exit(code);
	}

	static _handleRequest(req, res, redirectTo = null) {
		const RemoteIP = req.connection.remoteAddress.split(":")[3];
		const ProxyIP = req.headers["x-forwarded-for"];
		const HOST = req.headers["host"];
		const IP = ProxyIP || RemoteIP;
		const URL = url.parse(req.url, true);
		const IS_TRUSTED = this.TRUSTED_IPS.map(e => IP.includes(e)).includes(true);
		const IS_BLACKLISTED = this.BLACKLIST.map(e => IP.includes(e)).includes(true);

		if(!redirectTo) {
			if(IS_TRUSTED) this.log(`§2Incomming request from ${HOST ? `§2(${HOST})` : ""}§2${RemoteIP}${ProxyIP ? `§3(${ProxyIP})` : ""}§2: §2${req.method} §2${req.url}`);
			else this.log(`§2Incomming request from ${HOST ? `§2(${HOST})` : ""}§a${RemoteIP}${ProxyIP ? `§b(${ProxyIP})` : ""}§2: §a${req.method} §a${req.url}`);

			if(IS_BLACKLISTED) {
				this.warn("Blacklisted IP");
				return Send(res, "403 Forbidden", 403);
			}
		}

		//Request handling
		var destinationPath = redirectTo || URL.pathname;
		var EventObject = new /*this.*/RequestEvent({
			req,
			res,
			method: req.method,
			RemoteIP,
			ProxyIP,
			ProxyIP,
			IP,
			host: (HOST || ""),
			HOST: (HOST || ""), /* Deprecated */
			path: destinationPath,
			Path: destinationPath, /* Deprecated */
			query: URL.query,
			IS_TRUSTED,
			defaultPreventable: true,
			autoPrevent: true
		});

		//Fix destination path ending with "/"
		if(destinationPath.length > 1 && destinationPath.endsWith("/")) destinationPath = destinationPath.slice(0, -1);

		//Dispatch events
		this.dispatchEvent("request", EventObject);
		if(!EventObject.defaultPrevented) this.dispatchEvent(destinationPath, EventObject);

		//Dynamic destination path search
		var searchDispatched = [];
		for(var listener of this.listeners) {
			var type = listener.type;

			//Event was prevented
			if(EventObject.defaultPrevented) break;

			//Event was already dispatched
			if(searchDispatched.includes(type)) continue;

			//Create regex for each listener
			if(!("regex" in listener)) {
				if(["*", "?"].some(e => type.includes(e))) {
					listener.regex = new RegExp(type.replace(/(\.|\(|\)|\[|\]|\||\{|\}|\+|\^|\$|\/|\-|\\)/g, "\\$1").replace(/\?/g, "(.)").replace(/\*/g, "(.*)"), "i");
				} else {
					listener.regex = null;
					continue;
				}
			}

			//Listener uses dynamic representation of destination path
			if(listener.regex) {
				var match = destinationPath.match(listener.regex);

				//Destination path does not match required pattern
				if(!match) continue;

				//Add found matches to EventObject and dispatch event
				EventObject.matches = match.slice(1);
				this.dispatchEvent(type, EventObject);
				searchDispatched.push(type);
			}
		}

		//Default action
		if(!EventObject.defaultPrevented) {
			if(res.writableEnded) return this.warn(`Failed to write response after end. (Default action has not been prevented)`);

			try {
				EventObject.streamFile(path.join(PATH.PUBLIC, destinationPath.slice(1)));
			} catch(err) {
				EventObject.send("404 Not Found", 404);
			}
		}
	}

	static readRangeHeader(req, totalLength) {
		var header = req.headers["range"];

		if(!header) return null;

		var array = header.split(/bytes=([0-9]*)-([0-9]*)/);
		var start = parseInt(array[1]);
		var end = parseInt(array[2]);
		var range = {
			start: isNaN(start) ? 0 : start,
			end: isNaN(end) ? (totalLength - 1) : end
		};

		if(!isNaN(start) && isNaN(end)) {
			range.start = start;
			range.end = totalLength - 1;
		}

		if(isNaN(start) && !isNaN(end)) {
			range.start = totalLength - end;
			range.end = totalLength - 1;
		}

		return range;
	}

	static _connectionLog(status) {
		this.log(`§8Connection closed (${status})`);
	}

	static _loadConfig() {
		this.log("§7Loading cofiguration...");
		var name = path.basename(PATH.CONFIG);

		//Create default
		if(!fs.existsSync(PATH.CONFIG)) {
			this.log(`§7Creating default §f${name} §7file...`);
			fs.writeFileSync(PATH.CONFIG, JSON.stringify(DEFAULT_CONFIG, null, "\t"));
		}

		//Get current config
		var config = JSON.parse(fs.readFileSync(PATH.CONFIG).toString());
		var changes = 0;

		//Get missing options
		for(var property in DEFAULT_CONFIG) {
			if(property in config) continue;
			config[property] = DEFAULT_CONFIG[property];
			changes++;
		}

		//Update config
		if(changes) {
			fs.writeFileSync(PATH.CONFIG, JSON.stringify(config, null, "\t"));
			this.log(`§7Added §f${changes} §7new options to §f${name}`);
		}

		//Apply config
		this.config = config;

		this.log("§7Cofiguration loaded");
	}

	static _loadModules() {
		this.log("§7Loading modules...");
		const dirname = path.basename(path.dirname(PATH.MODULES + " "));

		//Create default
		if(!fs.existsSync(PATH.MODULES)) {
			this.log(`§7Creating new empty §f${dirname} §7folder...`);
			fs.mkdirSync(PATH.MODULES);

			fs.writeFileSync(PATH.MODULES + "main.js", DEFAULT_MAIN);
		}

		//Load modules
		const files = getAllFiles(PATH.MODULES, 1);
		for(var file of files) {
			let project = path.basename(path.dirname(file)); if(project == dirname) project = null;
			let filename = path.basename(file);
			const moduleName = (project ? project + "/" : "") + filename;

			//Skip not '*.js' files
			if(fs.lstatSync(file).isDirectory() || !file.endsWith(".js")) continue;

			//Execute file
			try {
				this.modules[moduleName] = {
					loaded: true,
					exports: require(file)
				};
				this.log(`§7Loaded §f${project ? project + "§7:§f" : ""}${filename}`);
			} catch(e) {
				this.modules[moduleName] = {
					loaded: false,
					exports: undefined
				};
				this.error(`Failed to load '${filename}':`, e);
			}
		}

		this.log(`§7Loaded §f${Object.values(this.modules).filter(e => e.loaded).length}§7/§f${Object.values(this.modules).length} §7modules`);
	}

	static _loadTrustedIPs() {
		this.log("§7Loading trusted IPs...");
		var name = path.basename(PATH.TRUSTED_IPS);

		//Create default
		if(!fs.existsSync(PATH.TRUSTED_IPS)) {
			this.log(`§7Creating new blank §f${name} §7file...`);
			fs.writeFileSync(PATH.TRUSTED_IPS, `["localhost"]`);
		}

		//Apply Trusted IPs
		this.TRUSTED_IPS = JSON.parse(fs.readFileSync(PATH.TRUSTED_IPS));

		this.log(`§7Loaded §f${this.TRUSTED_IPS.length} §7trusted IPs`);
	}

	static _loadBlacklist() {
		this.log("§7Loading blacklist...");
		var name = path.basename(PATH.BLACKLIST);

		//Create default
		if(!fs.existsSync(PATH.BLACKLIST)) {
			this.log(`§7Creating new blank §f${name} §7file...`);
			fs.writeFileSync(PATH.BLACKLIST, `[]`);
		}

		//Apply Blacklist
		this.BLACKLIST = JSON.parse(fs.readFileSync(PATH.BLACKLIST));

		this.log(`§7Loaded §f${this.BLACKLIST.length} §7blacklisted IPs`);
	}

	static formatMessage(msg) {
		var codes = ["30", "34", "32", "36", "31", "35", "33", "37", "90", "94", "92", "96", "91", "95", "93", "97"];
		var message = msg + "§r§7".replace(/§r/g, "\x1b[0m");
		//tmessage = message.replace(/§n/g, "\x1b[4m");
		var arr = message.split("§");
		var formatted = arr[0];
		if(arr.length > 1) {
			arr.shift();
			for(var i = 0; i < arr.length; i++) {
				var match = arr[i].match(/^[0-9a-f]/);
				if(match) formatted += "\x1b[" + codes[parseInt(match[0], 16)] + "m" + arr[i].substr(1);
				else continue;
			}
		} else {
			return message;
		}
		return formatted;
	}

	static formatTime(d = new Date()) {
		return `[${fixDigits(d.getHours())}:${fixDigits(d.getMinutes())}:${fixDigits(d.getSeconds())}]`;
	}

	static setTitle(title = "Node.js Server - " + __filename) {
		this.title = title;
		(process.stdout.__write || process.stdout.write).apply(process.stdout, [`${String.fromCharCode(27)}]0;${title}${String.fromCharCode(7)}`]);
	}

	static log(...args) {
		if(!this.stdio.settings.logs) return false;
		console.log(`${this.formatTime()} ${args.map(e => this.formatMessage(e)).join(" ")}`);
	}

	static warn(...args) {
		if(!this.stdio.settings.warnings) return false;
		const params = [];
		const format = args.map(arg => typeof arg === "string" ? arg : (params.push(arg), "%O")).join(" ");
		const message = util.formatWithOptions({colors: false, depth: 4}, `\x1b[33m${this.formatTime()} [WARN]: ${format}\x1b[0m`, ...params);
		console.warn(message);
	}

	static error(...args) {
		if(!this.stdio.settings.errors) return false;
		const params = [];
		const format = args.map(arg => typeof arg === "string" ? arg : (params.push(arg), "%O")).join(" ");
		const message = util.formatWithOptions({colors: false, depth: 4}, `\x1b[31m${this.formatTime()} [ERROR]: ${format}\x1b[0m`, ...params);
		console.error(message);
	}
}

/**
 *
 * @class RequestEvent
 * @extends {EventListener.Event}
 */
class RequestEvent extends EventListener.Event {
	constructor(data) {
		super(data);


		/**
		 * @type {http.IncomingMessage} Request object
		 */
		this.req;

		/**
		 * @type {http.ServerResponse} Response object
		 */
		this.res;

		/**
		 * @type {String} Request method
		 */
		this.method;

		/**
		 * @type {String} Remote IP address
		 */
		this.RemoteIP;

		/**
		 * @type {String} Forwarded IP address
		 */
		this.ProxyIP;

		/**
		 * @type {String} IP address of the client
		 */
		this.IP;

		/**
		 * @type {String} Request host
		 */
		this.host;

		/**
		 * @deprecated Use 'host' instead
		 * @type {String} Request host
		 */
		this.HOST;

		/**
		 * @type {String} Request destination path
		 */
		this.path;

		/**
		 * @deprecated Use 'path' instead
		 * @type {String} Request destination path
		 */
		this.Path;

		/**
		 * @type {Object} Request query string parameters object
		 */
		this.query;

		/**
		 * @type {Boolean} Tells if the request comes from trusted origin
		 */
		this.IS_TRUSTED;

		/**
		 * @type {Boolean} Enables auto prevent when calling methods 'get', 'post', 'send', 'sendFile', 'streamFile'...
		 */
		this.autoPrevent
	}

	/**
	 * Handles GET method
	 * @param {function(Object<String, any>):void} callback Request callback function
	 * @return {Boolean} True if request was successfully handled, otherwise false
	 * @memberof RequestEvent
	 */
	get(callback) {
		if(typeof callback !== "function") throw new TypeError("'callback' parameter is not type of function");

		if(this.req.method == "GET") {
			if(this.autoPrevent) this.defaultPrevented = true;

			callback(this.query);
			return true;
		} else return false;
	};

	/**
	 * Handles POST method
	 * @param {function(String|Object<String, any>, Buffer):void} callback Request callback function
	 * @param {"text"|"json"|"form"} [type="text"] Request body type (Default: "text")
	 * @return {Boolean} True if request was successfully handled, otherwise false
	 * @memberof RequestEvent
	 */
	post(callback, type = "text") {
		//TODO: Parse body by content-type header 
		if(typeof callback !== "function") throw new TypeError("'callback' parameter is not type of function");

		if(this.req.method == "POST") {
			if(this.autoPrevent) this.defaultPrevented = true;

			var buffer = Buffer.alloc(0);
			this.req.on("data", chunk => {
				buffer = Buffer.concat([buffer, chunk]);
			});
			this.req.on("end", () => {
				var body = buffer.toString();
				if(type == "json") {
					try {
						body = JSON.parse(body);
					} catch(e) {
						body = undefined;
					}
				} else if(type == "form") body = getQueryParameters(body);

				callback(body, buffer);
			});
			return true;
		} else return false;
	};

	/**
	 * Redirects destination path to another local path
	 * @example Server.on("/home", e => {
	 * e.redirect("/home.html");
	 * });
	 * @param {String} destination
	 * @memberof RequestEvent
	 */
	redirect(destination) {
		if(typeof destination !== "string") throw new TypeError("'destination' parameter is not type of string");

		this.preventDefault();
		this.stopPropagation();

		Server._handleRequest(this.req, this.res, destination);
	};

	//Authentication
	auth(callback, realm = "realm", credentials = Server.config.login) {
		var auth = this.req.headers.authorization;
		var basic = auth?.match(/Basic ([A-Za-z0-9+\/]*)/)?.[1];
		var bearer = auth?.match(/Bearer ([A-Za-z0-9+\/=\-_.~]*)/)?.[1];

		//No auth header
		if(!auth && (!basic || !bearer)) return this.send("", 401, "text/html", {'www-authenticate': `Basic realm="${realm}"`});

		//Bearer auth
		if(typeof credentials.token !== "undefined") {
			//Check access
			if(bearer == credentials.token) return Server.log(`§eToken '${bearer}' just used!`), callback(credentials);
			else return Server.log(`§eInvalid token attempt '${bearer}'!`), this.send("401 Unauthorized", 401);
		}

		//Basic auth
		if(typeof credentials.username !== "undefined" && typeof credentials.password !== "undefined") {
			//Decode credentials
			try {
				var [username, password] = atob(basic).split(":");
			} catch(e) {
				Server.error(e);
				return this.send("500 Error occured while decoding credentials", 401);
			}

			//Check access
			if(username == credentials.username && password == credentials.password) return Server.log(`§eUser '${username}' just logged in!`), callback(credentials);
			else return Server.log(`§eUnsuccessful login attempt '${username}:${password}'!`), this.send("401 Unauthorized", 401);
		}

		//Unsupported auth
		this.send("500 Cannot process provided authentication type", 500);
		throw new TypeError("Invalid credentials / unsupported authentication type", credentials);
	};

	/**
	 * Send response (shorthand for 'Send')
	 * @param {String|Object<String, any>|Buffer|ReadableStream} data Data to be sent as response
	 * @param {Number} [status=200] Response status code
	 * @param {String|"text/plain"|"text/html"|"application/json"|"image/png"|"audio/mpeg"|"video/mp4"} [contentType="text/plain"] Content type of the response
	 * @param {http.OutgoingHttpHeaders} [headers={}] Response headers
	 */
	send(data, status = 200, contentType = "text/plain", headers = {}) {
		this.preventDefault();
		if(this.res.writableEnded) return Server.warn(`Failed to write response after end. ('e.send()'/'e.streamFile()' might be called multiple times)`);

		//Send data
		Send(this.res, data, status, contentType, headers);
		Server._connectionLog(status);
	};

	//Stream file buffer
	async sendFile(filePath, status = 200, headers = {}) {
		this.preventDefault();
		if(this.res.writableEnded) return Server.warn(`Failed to write response after end. ('e.send()'/'e.streamFile()' might be called multiple times)`);

		const stat = await fs.promises.stat(filePath).catch(() => { });
		if(!stat || stat.isDirectory()) {
			Send(this.res, "404 Not Found", status = 404);
			Server._connectionLog(status);
			return false;
		}

		headers["Content-Length"] = stat.size;

		//Send file
		Send(this.res, fs.createReadStream(filePath), status, getContentType(filePath), headers);
		Server._connectionLog(status);
		return true;
	};

	//Stream file using parial content response
	async streamFile(filePath, headers = {}) {
		this.preventDefault();
		if(this.res.writableEnded) return Server.warn(`Failed to write response after end. ('e.send()'/'e.streamFile()' might be called multiple times)`), false;

		var status = 0;
		const contentType = getContentType(filePath);
		const stat = await fs.promises.stat(filePath).catch(() => { }); if(!stat || stat.isDirectory()) return Send(this.res, "404 Not Found", status = 404), Server._connectionLog(status), false;
		const range = Server.readRangeHeader(this.req, stat.size);

		if(!range) {
			headers["Content-Length"] = stat.size;
			Send(this.res, fs.createReadStream(filePath), status = 200, contentType, headers), Server._connectionLog(status);
			return true;
		}

		//Request cannot be fulfilled due to incorrect range
		if(range.start >= stat.size || range.end >= stat.size) {
			//Send correct range
			headers["Content-Range"] = `bytes */${stat.size}`;
			Send(this.res, "416 Range Not Satisfiable", status = 416, contentType, headers);
		} else {
			//Set up headers
			headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
			headers["Content-Length"] = range.start == range.end ? 0 : (range.end - range.start + 1);
			headers["Accept-Ranges"] = "bytes";
			//headers["Cache-Control"] = "no-cache";

			//Send part of file
			Send(this.res, fs.createReadStream(filePath, range), status = 206, contentType, headers);
		}
		Server._connectionLog(status);
		return true;
	};
}


class CookieJar {
	constructor() {
		/**
		 * @type {CookieJar.Cookie[]}
		 */
		this.cookies = [];

		if(arguments.length) this.setCookie.apply(this, arguments);
	}

	/**
	 * Adds cookie to the Jar
	 * @param {string|CookieJar.Cookie|http.ServerResponse} cookie Cookie name (requires second parameter), Cookie String, CookieJar.Cookie object, ServerResponseLike object
	 * @param {string} [value=undefined]
	 * @param {Object<string,any>} [options={}]
	 * @return {CookieJar} 
	 * @memberof CookieJar
	 */
	setCookie(cookie, value = undefined, options = {}) {
		//Set by name=value
		if(typeof value !== "undefined") {
			var _cookie = new CookieJar.Cookie();
			_cookie.name = cookie.trim();
			_cookie.value = (value ?? "").trim();

			for(var [i, key, value] of iterate(options)) {
				if(value == true) _cookie.flags.push(key);
				else if(value == false) _cookie.flags.splice(_cookie.flags.indexOf(key), 1);
				else _cookie.props[CookieJar.Cookie.formatKeyword(key) || key] = value;
			}

			this._addCookiesToJar(_cookie);
			return this;
		}

		//Set by Cookie object
		if(cookie instanceof CookieJar.Cookie) {
			this._addCookiesToJar(cookie);
			return this;
		}

		if(typeof cookie == "object") {
			var cookieString = cookie?.headers?.cookie;
			var header = cookie?.headers?.raw?.()?.["set-cookie"];
			var jsonObject = Object.keys(cookie) == "cookies" ? cookie.cookies : null;

			//Set by Request object
			if(cookieString) {
				var cookieStringArray = cookieString.split(";");
				var cookies = CookieJar.Cookie.parse(cookieStringArray);
				this._addCookiesToJar(...cookies);
			}

			//Set by Response object
			if(header) {
				var cookies = CookieJar.Cookie.parse(header);
				this._addCookiesToJar(...cookies);
			}

			//Set by JSON object
			if(jsonObject) {
				for(var cookieObject of jsonObject) {
					var _cookie = new CookieJar.Cookie();
					_cookie.name = cookieObject.name;
					_cookie.value = cookieObject.value;
					_cookie.props = cookieObject.props;
					_cookie.flags = cookieObject.flags;
					this._addCookiesToJar(_cookie);
				}
			}
			return this;
		}

		//TODO: Set by cookie string

		throw new TypeError("Cannot set cookie: " + cookie);
	}

	/**
	 * Retrns cookie object found by name
	 * @param {string} name Cookie name
	 * @return {CookieJar.Cookie} Cookie object if found, otherwise undefined
	 * @memberof CookieJar
	 */
	getCookie(name) {
		this._removeExpiredCookies();
		return this.cookies.find(cookie => cookie.name == name);
	}

	/**
	 * Removes cookie from the Jar
	 * @param {string|CookieJar.Cookie} cookie
	 * @return {CookieJar.Cookie} Deleted cookie
	 * @memberof CookieJar
	 */
	deleteCookie(cookie) {
		var _cookie = null;
		if(typeof cookie === "string") _cookie = this.getCookie(cookie);
		else if(cookie instanceof CookieJar.Cookie) _cookie = cookie;
		else throw new TypeError("Invalid cookie: " + cookie);

		var id = this.cookies.indexOf(_cookie);
		if(id < 0 || !_cookie) return false;
		else this.cookies.splice(id, 1);
		return _cookie;
	}

	/**
	 * Sends header with cookies
	 * @param {http.ServerResponse} response Server response object
	 * @param {boolean} [full=true] Include cookie properties and flags
	 * @return {CookieJar.Cookie} 
	 * @memberof CookieJar
	 */
	sendCookies(response, full = true) {
		this._removeExpiredCookies();
		response.setHeader("Set-Cookie", this.cookies.map(e => e.toString(full)));
		return this;
	}

	/**
	 * Converts Cookie object to cookie string 
	 * @param {boolean} [full=true] Include cookie properties and flags
	 * @return {string} Cookie String
	 * @memberof CookieJar
	 */
	toString(full = true) {
		this._removeExpiredCookies();
		return this.cookies.map(e => e.toString(full)).join("");
	}

	/**
	 * Checks if the Jar is empty
	 * @return {boolean} true if Jar is empty, otherwise false
	 * @memberof CookieJar
	 */
	isEmpty() {
		this._removeExpiredCookies();
		return this.cookies.length == 0;
	}

	/**
	 * Checks if the Jar contains cookie with certain name
	 * @param {string} name Cookie name
	 * @return {boolean} true if Jar contians cookie with certain name, otherwise false
	 * @memberof CookieJar
	 */
	includes(name) {
		this._removeExpiredCookies();
		return !!this.getCookie(name);
	}

	/**
	 * Adds cookies to the Jar
	 * @param {CookieJar.Cookie} cookies
	 * @memberof CookieJar
	 */
	_addCookiesToJar(...cookies) {
		for(var cookie of cookies) {
			this.deleteCookie(cookie.name);
			this.cookies.push(cookie);
		}
		this._removeExpiredCookies();
	}

	/**
	 * Removes expired cookies from the Jar
	 * @memberof CookieJar
	 */
	_removeExpiredCookies() {
		for(var cookie of this.cookies) {
			if(cookie.props["Expires"] && new Date(cookie.props["Expires"]) < new Date()) this.deleteCookie(cookie);
		}
	}
}

/**
 * @typedef {Object} Cookie
 */
CookieJar.Cookie = class Cookie {
	/**
	 * @typedef {Object} CookieProperties
	 * @prop {string} [Expires] The maximum lifetime of the cookie as an HTTP-date timestamp.
	 * @prop {string} [Max-Age] Number of seconds until the cookie expires. A zero or negative number will expire the cookie immediately.
	 * @prop {string} [Domain] Host to which the cookie will be sent.
	 * @prop {string} [Path] A path that must exist in the requested URL, or the browser won't send the `Cookie` header.
	 * @prop {string} [SameSite] Controls whether a cookie is sent with cross-origin requests, providing some protection against cross-site request forgery attacks (CSRF).
	 */

	constructor() {
		this.name = "";
		this.value = "";

		/**
		 * @type {CookieProperties}
		 */
		this.props = {};

		/**
		 * @type {Array<"Secure"|"HttpOnly">}
		 */
		this.flags = [];
	}

	/**
	 * Convert cookie to cookie string
	 * @param {boolean} [full=true] Include cookie properties and flags
	 * @return {string} Cookie String
	 */
	toString(full = true) {
		var head = `${this.name}=${this.value}; `;
		var props = this.props.reduce((prev, {key, value}) => prev + `${key}=${value}; `, "");
		var flags = this.flags.join("; ");

		return full ? (head + props + flags + (flags ? "; " : "")) : head;
	}

	static keywords = ["Expires", "Max-Age", "Domain", "Path", "Secure", "HttpOnly", "SameSite"];
	static formatKeyword(key) {
		for(var keyword of this.keywords) {
			if(keyword.toLowerCase() == key.toLowerCase()) return keyword;
		}
		return false;
	}

	static parse(cookieStringArray) {
		return cookieStringArray.map(cookieString => {
			var cookie = new CookieJar.Cookie();
			var properties = cookieString.split(/;\s*/);

			for(var property of properties) {
				if(!property) continue;

				var {key, value, flag} = property.match(/(?:(?<key>.*?)=(?<value>.*)|(?<flag>.*))/)?.groups || {};

				if(key) {
					if(!cookie.name && !cookie.value) {
						cookie.name = key.trim();
						cookie.value = value.trim();
					} else {
						cookie.props[this.formatKeyword(key) || key] = value;
					}
				} else if(flag) {
					cookie.flags.push(flag);
				} else {
					//throw new TypeError("Failed to parse cookie: '" + property + "'");
					Server.warn("Failed to parse cookie: '" + property + "'");
				}
			}

			return cookie;
		});
	}
};


// class CLI extends EventListener {
// 	constructor({stdin, stdout, stderr}) {
// 		super();

// 		/**
// 		 * @type {
// 				((event: 'command', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
// 				((event: 'input', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
// 				((event: 'stdout', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
// 				((event: 'stderr', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
// 				((event: 'stderr', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
// 				((event: 'unknownCommand', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
// 				((event: 'keypress', listener: (event: EventListener.Event) => void) => EventListener.Listener) &
// 				((event: 'load', listener: (event: EventListener.Event) => void) => EventListener.Listener)
// 			}
// 		*/
// 		this.on;

// 		this.stdin = stdin;
// 		this.stdout = stdout;
// 		this.stderr = stderr;

// 		this.isResumed = false;
// 		this.buffer = "";
// 		this.current = "";
// 		this.cursor = 0;
// 		this.history = [];
// 		this.pointer = 0;
// 	}

// 	begin() {
// 		//Setup stdin
// 		this.stdin.setRawMode(true);
// 		this.stdin.setEncoding("utf8");
// 		this.stdin.on("data", key => this._keyPressed(key, this.stdout));

// 		//Setup stdout
// 		this.stdout.setEncoding("utf8");
// 		this.stdout.__write = this.stdout.write;
// 		this.stdout.write = (string, encoding, fd) => {
// 			this.dispatchEvent("stdout", {data: string, string: this._unescape(string)});
// 			this.stdout.__write.apply(this.stdout, [(this.isResumed ? "\r\x1b[K" : "") + string, encoding, fd]);
// 			this._updateCLI();
// 		};

// 		//Setup stderr
// 		this.stderr.setEncoding("utf8");
// 		this.stderr.__write = this.stderr.write;
// 		this.stderr.write = (string, encoding, fd) => {
// 			this.dispatchEvent("stderr", {data: string, string: this._unescape(string)});
// 			this.stderr.__write.apply(this.stderr, [(this.isResumed ? "\r\x1b[K" : "") + string, encoding, fd]);
// 			this._updateCLI();
// 		};

// 		//Begin
// 		this.stdout.write("> ");
// 		this.resume();

// 		this.dispatchEvent("load");
// 	}

// 	pause() {
// 		this.isResumed = false;
// 		this.stdin.pause();
// 	}

// 	resume() {
// 		this.isResumed = true;
// 		this.stdin.resume();
// 	}

// 	_updateCLI() {
// 		var offset = this.buffer.length - this.cursor;
// 		this.stdout.__write.apply(this.stdout, ["\r\x1b[K" + "> " + this.buffer + (offset ? "\x1b[" + offset + "D" : "")]);
// 	}

// 	_unescape(string) {
// 		return string.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
// 	}

// 	_keyPressed(key, stream = this.stdout) {
// 		if(key == KEY.ARROW_UP) {
// 			if(this.pointer == this.history.length) this.current = this.buffer;
// 			if(this.pointer) {
// 				this.buffer = this.history[--this.pointer];
// 				this.cursor = this.buffer.length;

// 				this._updateCLI();
// 			}
// 		}
// 		else if(key == KEY.ARROW_DOWN) {
// 			if(this.pointer < this.history.length) {
// 				this.buffer = this.history[++this.pointer] || this.current;
// 				this.cursor = this.buffer.length;

// 				this._updateCLI();
// 			}
// 		}
// 		else if(key == KEY.ARROW_LEFT) {
// 			this.cursor--;
// 			if(this.cursor < 0) this.cursor = 0;
// 			else stream.__write.apply(stream, [key]);
// 		}
// 		else if(key == KEY.ARROW_RIGHT) {
// 			this.cursor++;
// 			if(this.cursor > this.buffer.length) this.cursor = this.buffer.length;
// 			else stream.__write.apply(stream, [key]);
// 		}
// 		else if(key == KEY.CTRL_ARROW_LEFT) {
// 			var jumps = [...this.buffer.matchAll(/\b/g)].map(e => e.index).reverse();
// 			var index = jumps.find(e => e < this.cursor && this.cursor - e != 1) || 0;

// 			this.cursor = index;
// 			this._updateCLI();
// 		}
// 		else if(key == KEY.CTRL_ARROW_RIGHT) {
// 			var jumps = [...this.buffer.matchAll(/\b/g)].map(e => e.index);
// 			var index = jumps.find(e => e > this.cursor && e - this.cursor != 1) || this.buffer.length;

// 			this.cursor = index;
// 			this._updateCLI();
// 		}
// 		else if(key == KEY.BACKSPACE) {
// 			this.cursor--; if(this.cursor < 0) return this.cursor = 0;
// 			this.buffer = this.buffer.substring(0, this.cursor) + this.buffer.substring(this.cursor + 1);

// 			this._updateCLI();
// 		}
// 		else if(key == KEY.DELETE) {
// 			this.buffer = this.buffer.substring(0, this.cursor) + this.buffer.substring(this.cursor + 1);

// 			this._updateCLI();
// 		}
// 		else if(key == KEY.CTRL_BACKSPACE) {
// 			var jumps = [...this.buffer.matchAll(/\b/g)].map(e => e.index).reverse();
// 			var index = jumps.find(e => e < this.cursor && this.cursor - e != 1) || 0;

// 			this.buffer = this.buffer.substring(0, index) + this.buffer.substring(this.cursor + 1);
// 			this.cursor = index;

// 			this._updateCLI();
// 		}
// 		else if(key == KEY.CTRL_DELETE) {
// 			var jumps = [...this.buffer.matchAll(/\b/g)].map(e => e.index);
// 			var index = jumps.find(e => e > this.cursor && e - this.cursor != 1) || this.buffer.length;

// 			this.buffer = this.buffer.substring(0, this.cursor) + this.buffer.substring(index + 1);

// 			this._updateCLI();
// 		}
// 		else if(key == KEY.RETURN) {
// 			if(this.buffer && this.buffer != this.history[this.history.length - 1]) this.pointer = this.history.push(this.buffer);
// 			else this.pointer = this.history.length;

// 			var input = this.buffer;
// 			var args = input.trim().split(" ");
// 			var command = args.shift();

// 			this.buffer = "";
// 			this.cursor = 0;

// 			this.dispatchEvent("stdout", {data: ("> " + input + "\n"), string: this._unescape("> " + input + "\n")});
// 			stream.__write.apply(stream, ["\n> "]);
// 			this.dispatchEvent("command", {input, command, args}, event => {
// 				this.dispatchEvent("unknownCommand", event);
// 			});
// 			this.dispatchEvent("input", {input});
// 		} else {
// 			this.buffer = this.buffer.substring(0, this.cursor) + key + this.buffer.substring(this.cursor);
// 			this.cursor++;

// 			this._updateCLI();
// 		}

// 		this.dispatchEvent("keypress");
// 	}
// }

// const KEY = {
// 	RETURN: "\015",
// 	BACKSPACE: "\010",
// 	CTRL_BACKSPACE: "\177",
// 	DELETE: "\x1b[3~",
// 	CTRL_DELETE: "\x1b[3;5~",
// 	ARROW_UP: "\x1b[A",
// 	ARROW_DOWN: "\x1b[B",
// 	ARROW_LEFT: "\x1b[D",
// 	CTRL_ARROW_LEFT: "\x1b[1;5D",
// 	ARROW_RIGHT: "\x1b[C",
// 	CTRL_ARROW_RIGHT: "\x1b[1;5C",
// };
// exports.KEY = KEY;

const DEFAULT_CONFIG = {
	"http-port": 80,
	"enable-cli": true,
	"debug": true,
	"login": {
		"username": "admin",
		"password": "admin"
	}
};

const DEFAULT_MAIN = `const {Server, CookieJar} = require("../server.js");

//Handle load event 
Server.on("load", e => {
	Server.log("§aThis is my colored message!");

	//Using server CLI
	Server.stdio.cli.on("command", cmd => {
		//'input' is whole input
		//'command' is issued command
		//'args' is array of command arguments 
		const {input, command, args} = cmd;

		//'say' command
		if(command == "say") {
			Server.log("You just said: " + input);
		}
		//'info' command
		else if(command == "info") {
			Server.log("You issued", command, "command with", args.length, "arguments, all together as:", input);
		}
		//This is not our command, just ignore it
		else return;

		//Remeber to always prevent default action of the event,
		//otherwise 'unknownCommand' event will be fired!
		e.preventDefault();
	});
});

//Handle simple request
Server.on("/hello", e => {
	e.send("Hey!");
});

//Handle dynamic request
//There are two special characters available:
//'*' - extends to /(.*)/ regex (matches 0 or more characters)
//'?' - extends to /(.)/ regex (matches 1 character)
//Example: let's say we want format like this: '/user/<user>/<page>' => '/user/john123/profile'
Server.on("/user/*/*", e => {
	//e.matches contains ordered matches from requested url
	//get 'user' and 'page' from matched url
	const [user, page] = e.matches;

	if(page == "profile") {
		//Send user their profile page
		e.send("Welcome back " + user);
	} else if(page == "settings") {
		//do more stuff...
	}

	//If no response was sent, the 404 status will be sent
});

//Redirect request to another path
Server.on("/", e => {
	//Since there is no "/index.html" handler this will
	//respond with file "/public/index.html" (if it exists)
	e.redirect("/index.html");
});

//Handle different request methods
Server.on("/request", e => {
	//Handle GET method
	e.get(query => {
		e.send("GET: Your sent query string: " + JSON.stringify(query));
	});

	//Handle POST method
	e.post(body => {
		e.send("POST: Your sent data: " + body);
	});

	//POST requests may have defined (second parameter of the post function) body data type (json or form),
	//those will get parsed into JSON object.
	//Second parameter of the callback is body buffer
	// e.post((body, buffer) => {
	// 	e.send("POST: Your sent data parsed as JSON: " + JSON.stringify(body));
	// }, "json");
});

//Advanced request handling
Server.on("/request", e => {
	//Get values from event object
	const {req, res, method} = e;

	//Get cookies from request object
	var cookies = new CookieJar(req);

	//If there is no 'session' cookie, send error with 401 status code
	if(!cookies.getCookie("session") && method == "GET")
		return e.send("Error: You do not have session token yet! Send POST request to get one!", 401);

	//Handle GET method
	e.get(query => {
		//Get value of 'session' cookie
		var session = cookies.getCookie("session").value;

		//Check database if the session token is valid
		if(session == "T0yS2KoavK59Xy5y7YXc87nQ") {
			//Send successful response
			e.send("GET: Congratulations! You have logged in!");
		} else {
			//Send unsuccessful response
			e.send("GET: Your session token is invalid! Try to log in!", 401);
		}
	});

	//Handle POST method
	e.post(body => {
		//Generate new session token cookie and add it to cookie jar
		//Note: This will overwrite the original value
		cookies.setCookie("session", "T0yS2KoavK59Xy5y7YXc87nQ");

		//Send updated cookies
		cookies.send(res);

		//Send successful response
		e.send("POST: Your new session toeken has been generated! You can log in now!" + body);
	});
});`;

const CONTENT_TYPES = {
	".aac": "audio/aac",
	".avi": "video/x-msvideo",
	".bin": "application/octet-stream",
	".bmp": "image/bmp",
	".bz": "application/x-bzip",
	".bz2": "application/x-bzip2",
	".csh": "application/x-csh",
	".css": "text/css",
	".csv": "text/csv",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".eot": "application/vnd.ms-fontobject",
	".gz": "application/gzip",
	".gif": "image/gif",
	".html": "text/html",
	".htm": "text/html",
	".ico": "image/vnd.microsoft.icon",
	".ics": "text/calendar",
	".jar": "application/java-archive",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".js": "text/javascript",
	".json": "application/json",
	".mid": "audio/midi",
	".midi": "audio/midi",
	".mjs": "text/javascript",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".mpeg": "video/mpeg",
	".mpkg": "application/vnd.apple.installer+xml",
	".oga": "audio/ogg",
	".ogv": "video/ogg",
	".ogx": "application/ogg",
	".otf": "font/otf",
	".png": "image/png",
	".pdf": "application/pdf",
	".php": "application/x-httpd-php",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".rar": "application/vnd.rar",
	".rtf": "application/rtf",
	".sh": "application/x-sh",
	".svg": "image/svg+xml",
	".tar": "application/x-tar",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".ts": "video/mp2t",
	".ttf": "font/ttf",
	".txt": "text/plain",
	".wav": "audio/wav",
	".webm": "audio/webm",
	".weba": "video/webm",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".xhtml": "application/xhtml+xml",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".xml": "application/xml",
	".zip": "application/zip",
	".7z": "application/x-7z-compressed"
};

/* Helper Functions */
function readFileAsync(path, ...options) {
	return new Promise((resolve, reject) => {
		fs.readFile(path, ...options, function(error, data) {
			if(error) reject(error);
			else resolve(data);
		});
	});
}

function writeFileAsync(path, data, ...options) {
	return new Promise((resolve, reject) => {
		fs.writeFile(path, data, ...options, function(error) {
			if(error) reject(error);
			else resolve();
		});
	});
}

function Send(res, data, status = 200, type = "text/plain", headers = {}) {
	const isObject = typeof data === "object";
	const isBuffer = data instanceof Buffer;
	const isStream = !!data.pipe;

	res.writeHead(status, {
		"Content-Type": (isBuffer || isStream) ? type : (isObject ? "application/json" : type),
		...headers
	});
	if(isStream) {
		data.pipe(res);
	} else {
		res.write(isBuffer ? data : (isObject ? JSON.stringify(data) : data + ""));
		res.end();
	}
}

async function editJSON(path, callback = null) {
	var json = JSON.parse(await readFileAsync(path));
	if(typeof callback === "function") {
		var newJson = callback(json);
		await writeFileAsync(path, JSON.stringify(newJson));
		return newJson;
	} else return json;
}

function getContentType(filename, dismatch = "text/plain") {
	return CONTENT_TYPES[filename.match(/(\.\w+)$/mi)?.[0]] || dismatch;
}

function getFileFormat(contentType, dismatch = "") {
	return Object.keys(CONTENT_TYPES).find(key => CONTENT_TYPES[key] == contentType) || dismatch;
}

function getAllFiles(dirPath, depth = Infinity, i = 0, arrayOfFiles = []) {
	if(i > depth) return arrayOfFiles;

	files = fs.readdirSync(dirPath);

	files.forEach(function(file) {
		if(fs.statSync(dirPath + "/" + file).isDirectory()) {
			arrayOfFiles = getAllFiles(dirPath + "/" + file, depth, i + 1, arrayOfFiles);
		} else {
			arrayOfFiles.push(path.join(dirPath, "/", file));
		}
	});

	return arrayOfFiles;
}

function encrypt(str, strength, uri = false) {
	var codes = [];
	strength %= 256;

	for(var i = 0; i < str.length; i++) {
		var char = str.charCodeAt(i);
		codes[i] = i % 2 ? char ^ strength : char ^ (256 - strength);
	}

	var chars = codes.map(e => String.fromCharCode(e)).join("");
	var fixedRange = unescape(encodeURIComponent(chars));
	var hash = btoa(fixedRange);

	return uri ? hash.replace(/\+/g, ".").replace(/\//g, "_").replace(/=/g, "-") : hash;
}

function decrypt(hash, strength) {
	var fixedRange = atob(hash.replace(/\./g, "+").replace(/_/g, "/").replace(/-/g, "="));
	var chars = decodeURIComponent(escape(fixedRange));
	var codes = [];
	strength %= 256;

	for(var i = 0; i < chars.length; i++) {
		var char = chars.charCodeAt(i);
		codes[i] = i % 2 ? char ^ strength : char ^ (256 - strength);
	}

	var str = codes.map(e => String.fromCharCode(e)).join("");

	return str;
}

module.exports = {
	Server,
	CookieJar,
	CLI,
	KEY,
	atob,
	btoa,
	encrypt,
	decrypt,
	readFileAsync,
	writeFileAsync,
	getAllFiles,
	Send,
	editJSON,
	getContentType,
	getFileFormat
};

Server.begin();