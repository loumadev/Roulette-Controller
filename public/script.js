const PLACE = {
	config: null,
	state: null
};

const STATE = {
	BOOT: 0,
	UP: 1,
	DOWN: 2
};

const ELM = {
	LOCK_SELECT: JL(".lock select"),
	LOCK_CHECKBOX: JL(".lock input"),
};

class API {
	static async getConfig() {
		return await this._send(`/api/config`);
	}

	static async toggleState(state) {
		return await this._send(`/api/toggle?state=${state}`);
	}

	static async updateConfig(config) {
		return await this._send(`/api/update`, config);
	}

	static async _send(url, data = null) {
		return await fetch(url, {
			method: data ? "POST" : "GET",
			body: data ? JSON.stringify(data) : null
		})
			.then(res => res.json())
			.catch(err => {
				console.error(err);
				return {"success": false, "error": err};
			})
			.then(json => {
				if(!json.success) alert("Error: " + json.error);
				return json;
			});
	}
}

async function main() {
	await loadConfig();

	updatePlaces();
}

function generatePlace() {
	const node = parseHTML(`<section class="table column" data-name="${PLACE.config.NAME}">
		<article class="title table row v-center">
			<span>${PLACE.config.NAME}</span>
			<div class="state" data-state="${PLACE.state}"></div>
		</article>
		<article class="schedule table column">
			<label>Schedule</label>
			<div class="item table row">
				<span title="Starting time of the schedule">Start:</span>
				<input class="start" type="time" step="60" value="${fixDigits(PLACE.config.START.h)}:${fixDigits(PLACE.config.START.m)}">
			</div>
			<div class="item table row">
				<span title="Ending time of the schedule">Stop:</span>
				<input class="stop" type="time" step="60" value="${fixDigits(PLACE.config.STOP.h)}:${fixDigits(PLACE.config.STOP.m)}">
			</div>
			<div class="item table row">
				<span title="Time in SECONDS between shutdown and bootup">Delay:</span>
				<input class="delay" type="number" step="1" min="0" max="3600" value="${Math.floor(PLACE.config.DELAY / 1000)}">
			</div>
		</article>
		<article class="lock table column">
			<label>Lock state</label>
			<div class="item table row v-center">
				<select value="${PLACE.config.LOCKED}" title="Select state to lock">
					<option value="null" disabled hidden>Select</option>
					<option value="1">Running</option>
					<option value="2">Stopped</option>
				</select>
				<input type="checkbox" id="lock" ${PLACE.config.LOCKED == null ? "" : "checked"}>
				<label for="lock" class="table center" title="Lock selected state">
					<svg viewBox="0 0 576 512" style="margin-left: 4px" class="unlocked">
						<path fill="currentColor" d="M423.5 0C339.5.3 272 69.5 272 153.5V224H48c-26.5 0-48 21.5-48 48v192c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V272c0-26.5-21.5-48-48-48h-48v-71.1c0-39.6 31.7-72.5 71.3-72.9 40-.4 72.7 32.1 72.7 72v80c0 13.3 10.7 24 24 24h32c13.3 0 24-10.7 24-24v-80C576 68 507.5-.3 423.5 0zM264 392c0 22.1-17.9 40-40 40s-40-17.9-40-40v-48c0-22.1 17.9-40 40-40s40 17.9 40 40v48z"></path>
					</svg>
					<svg viewBox="0 0 448 512" class="locked">
						<path fill="currentColor" d="M400 224h-24v-72C376 68.2 307.8 0 224 0S72 68.2 72 152v72H48c-26.5 0-48 21.5-48 48v192c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V272c0-26.5-21.5-48-48-48zM264 392c0 22.1-17.9 40-40 40s-40-17.9-40-40v-48c0-22.1 17.9-40 40-40s40 17.9 40 40v48zm32-168H152v-72c0-39.7 32.3-72 72-72s72 32.3 72 72v72z"></path>
					</svg>
				</label>
			</div>
		</article>
		<article class="manual table column">
			<label>Manual control</label>
			<div class="item table row wrap">
				<button class="start secondary" onclick="confirm('Do you really want to turn the roulette ON (${PLACE.config.NAME})?') && toggleState(STATE.UP)" title="Send signal to start the roulette manually">Start</button>
				<button class="stop secondary" onclick="confirm('Do you really want to turn the roulette OFF (${PLACE.config.NAME})?') && toggleState(STATE.DOWN)" title="Send signal to stop the roulette manually">Stop</button>
				<button class="apply primary" onclick="confirm('Do you really want to save all changed values (${PLACE.config.NAME})?') && saveChanges('${PLACE.config.NAME}')" title="Save changes">Apply</button>
				<button class="reload secondary" onclick="updatePlaceData('${PLACE.config.NAME}')" title="Save changes">Reload</button>
			</div>
		</article>
	</section>`);

	return node;
}

async function saveChanges() {
	const section = JL(`section[data-name="${PLACE.config.NAME}"]`);

	const start = JL(section, "input.start").value.split(":");
	const stop = JL(section, "input.stop").value.split(":");
	const delay = JL(section, "input.delay").value;
	const locked = JL(section, `.lock input[type="checkbox"]`).checked;
	const lockState = +JL(section, `.lock select`).value;

	if(locked && isNaN(lockState)) return alert(`Invalid 'lockState': You have to select locked state before locking it!`);

	PLACE.config.START.h = +start[0];
	PLACE.config.START.m = +start[1];

	PLACE.config.STOP.h = +stop[0];
	PLACE.config.STOP.m = +stop[1];

	PLACE.config.DELAY = +delay * 1000;
	PLACE.config.LOCKED = locked ? lockState : null;

	const res = await API.updateConfig(PLACE.config); console.log(res);
	PLACE.config = res.config;
	PLACE.state = res.state;
	updatePlaceElement();
}

function updatePlaces() {
	JL("main").innerHTML = "";
	JL("main").appendChild(generatePlace());
}

async function updatePlaceData() {
	const res = await API.getConfig(); console.log(res);
	PLACE.config = res.config;
	PLACE.state = res.state;

	updatePlaceElement();
}

function updatePlaceElement() {
	const section = JL(`section[data-name="${PLACE.config.NAME}"]`);

	section.replaceWith(generatePlace());
}

async function loadConfig() {
	console.log(`Loading configuration...`);
	const res = await API.getConfig(); console.log(res);
	PLACE.config = res.config;
	PLACE.state = res.state;
	console.log("Configuration loaded", PLACE);
}

async function toggleState(state) {
	const res = await API.toggleState(state); console.log(res);
	PLACE.state = res.state;

	updatePlaceElement();
}

main();