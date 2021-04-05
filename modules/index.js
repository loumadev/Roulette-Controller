const {Server, editJSON} = require("../server.js");
const fs = require("fs");
const Gpio = require("onoff").Gpio;
const {getUniqueID} = require("../JustLib.js");

const STATE = {
	BOOT: 0,
	UP: 1,
	DOWN: 2
};

const PATH_CONFIG = __dirname + "/config.json";
const DEFAULT_CONFIG = {
	NAME: "Some name",
	START: {h: 18, m: 32},
	STOP: {h: 18, m: 34},
	DELAY: 5000,
	IMPULSE: 500,
	LOCKED: null
};

/*const RELAY = {
	START: new Gpio(4, "out"),
	STOP: new Gpio(5, "out")
};*/

Server.on("load", e => {
	Roulette.init();
	Roulette.updateState(STATE.BOOT);
});

Server.on("/", e => {
	e.redirect("/page.html");
});

Server.on("/api/config", e => {
	e.send({
		"success": true,
		"config": Roulette.config,
		"state": Roulette.state
	});
});

Server.on("/api/toggle", e => {
	const {state} = e.query;

	Roulette.sendSignal(state);

	e.send({
		"success": true,
		"state": Roulette.state
	});
});

Server.on("/api/update", e => {
	e.post(config => {
		Roulette.config = config;
		Roulette.saveConfig();

		Roulette.updateState(STATE.BOOT);

		e.send({
			"success": true,
			"config": Roulette.config,
			"state": Roulette.state
		});
	}, "json");
});

class Roulette {
	static config = null;
	static state = null;
	static middleState = null;
	static session = null;

	static init() {
		/*if(!fs.existsSync(PATH_CONFIG)) {
			fs.writeFileSync(PATH_CONFIG, JSON.stringify(DEFAULT_CONFIG, null, "\t"));
		}

		this.config = JSON.parse(fs.readFileSync(PATH_CONFIG).toString());*/

		this.config = DEFAULT_CONFIG;

		/*var t = new Date("2021.02.14 12:57");
		console.log(t);
		executeAt(t, () => {
			console.log("Executed!!!");
		});*/
	}

	static sendSignal(state = false) {
		if(this.config.LOCKED !== null) {
			state = this.config.LOCKED;
		}

		this.state = state;
		Server.log(`Sending signal to ` + state);
	}

	static updateState(state = STATE.BOOT) {
		const session = getUniqueID(24);
		this.session = session;

		var now = new Date(/*"2021.02.16. 18:00"*/);
		now.setSeconds(0, 0);

		var start = new Date(now); start.setHours(this.config.START.h, this.config.START.m);
		var stop = new Date(now); stop.setHours(this.config.STOP.h, this.config.STOP.m);

		fixTime(now);
		fixTime(start);
		fixTime(stop);

		//On boot
		if(state == STATE.BOOT) {
			state = isInRange(now, start, stop) ? 1 : 2;
			if(state == STATE.UP) {
				console.log("running");
				setTimeout(() => {
					if(session != this.session) return console.log("Newer session found, ignoring this one.");
					this.sendSignal(true);
				}, this.config.DELAY);
			}
			if(state == STATE.DOWN) {
				console.log("stopped");
				setTimeout(() => {
					if(session != this.session) return console.log("Newer session found, ignoring this one.");
					this.sendSignal(false);
				}, this.config.DELAY);	//Is it really required?
			}
		}

		if(start <= now) start.setHours(start.getHours() + 24);
		if(stop <= now) stop.setHours(stop.getHours() + 24);

		console.log(now, ":", start, stop);

		if(state == STATE.UP) {
			executeAt(stop, () => {
				if(session != this.session) return console.log("Newer session found, ignoring this one.");
				console.log("stopping...");
				this.sendSignal(false);
				this.updateState(STATE.DOWN);
			});
		}
		if(state == STATE.DOWN) {
			executeAt(start, () => {
				if(session != this.session) return console.log("Newer session found, ignoring this one.");
				console.log("starting...");
				this.sendSignal(true);
				this.updateState(STATE.UP);
			});
		}
	}

	static saveConfig() {
		editJSON(PATH_CONFIG, json => {
			json = this.config;
			return json;
		});
	}
}


function fixTime(date) {
	date.setTime(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
}

function executeAt(time, callback) {
	var t = new Date(); fixTime(t);
	if(t > time) {
		console.error("Invalid time");
		return false;
	}
	console.log(time - t, time, t, "Timeout");
	setTimeout(callback, time - t);
	return true;
}

function isInRange(date, from, to) {
	if(to < from) to.setHours(to.getHours() + 24);

	return date >= from && date <= to;
}