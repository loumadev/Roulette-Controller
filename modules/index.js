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

const RELAY = {
	START: new Gpio(26, "out"),
	STOP: new Gpio(20, "out")
};

Server.on("load", e => {
	Roulette.init();
	Roulette.updateState(STATE.BOOT);
});

Server.on("unload", e => {
	RELAY.START.unexport();
	RELAY.STOP.unexport();
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

		Roulette.updateState(STATE.BOOT, false);

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
	static session = null;

	static init() {
		if(!fs.existsSync(PATH_CONFIG)) {
			fs.writeFileSync(PATH_CONFIG, JSON.stringify(DEFAULT_CONFIG, null, "\t"));
		}

		this.config = JSON.parse(fs.readFileSync(PATH_CONFIG).toString());
	}

	static sendSignal(state = STATE.DOWN) {
		if(this.config.LOCKED !== null) {
			state = this.config.LOCKED;
		}

		this.state = state;
		Server.log(`Sending signal to ` + state);

		var relay = null;
		if(state == STATE.UP) relay = RELAY.START;
		else if(state == STATE.DOWN) relay = RELAY.STOP;

		relay.writeSync(1);
		setTimeout(() => relay.writeSync(0), 500);
	}

	static updateState(state = STATE.BOOT, updateNow = true) {
		const session = getUniqueID(24);
		this.session = session;

		var now = new Date();
		now.setSeconds(0, 0);

		var start = new Date(now); start.setHours(this.config.START.h, this.config.START.m);
		var stop = new Date(now); stop.setHours(this.config.STOP.h, this.config.STOP.m);

		fixTime(now);
		fixTime(start);
		fixTime(stop);

		//On boot
		if(state == STATE.BOOT) {
			state = isInRange(now, start, stop) ? STATE.UP : STATE.DOWN;
			this.state = STATE.BOOT;

			if(updateNow) {
				if(state == STATE.UP) {
					console.log("running");
					setTimeout(() => {
						if(session != this.session) return console.log("Newer session found, ignoring this one.");
						this.sendSignal(STATE.UP);
					}, this.config.DELAY);
				}
				if(state == STATE.DOWN) {
					console.log("stopped");
					setTimeout(() => {
						if(session != this.session) return console.log("Newer session found, ignoring this one.");
						this.sendSignal(STATE.DOWN);
					}, this.config.DELAY);	//Is it really required?
				}
			}
		}

		if(start <= now) start.setHours(start.getHours() + 24);
		if(stop <= now) stop.setHours(stop.getHours() + 24);

		console.log(now, ":", start, stop);

		if(state == STATE.UP) {
			executeAt(stop, () => {
				if(session != this.session) return console.log("Newer session found, ignoring this one.");
				console.log("stopping...");
				this.sendSignal(STATE.DOWN);
				this.updateState(STATE.DOWN);
			});
		}
		if(state == STATE.DOWN) {
			executeAt(start, () => {
				if(session != this.session) return console.log("Newer session found, ignoring this one.");
				console.log("starting...");
				this.sendSignal(STATE.UP);
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