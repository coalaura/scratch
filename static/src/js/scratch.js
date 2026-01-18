import "../css/scratch.css";

import DOMPurify from "dompurify";
import { createIcons, icons } from "lucide";
import { marked } from "marked";

const state = {
	token: localStorage.getItem("scratch_token"),
	notes: [],
	busy: false,
	activeNoteId: null,
	copyTimeout: null,
	lastSaved: {
		title: "",
		body: "",
		tags: [],
	},
};

const $authLayer = document.getElementById("auth-layer"),
	$inputAuth = document.getElementById("input-auth"),
	$loginBtn = document.getElementById("btn-login"),
	$logoutBtn = document.getElementById("btn-logout"),
	$authError = document.getElementById("auth-error"),
	$versionLabel = document.getElementById("label-version"),
	$noteList = document.getElementById("note-list"),
	$emptyState = document.getElementById("empty-state"),
	$editorContainer = document.getElementById("editor-container"),
	$inputTitle = document.getElementById("input-title"),
	$inputTag = document.getElementById("input-tag"),
	$tagContainer = document.getElementById("tag-container"),
	$editorBody = document.getElementById("editor-body"),
	$previewBody = document.getElementById("preview-body"),
	$status = document.getElementById("status-indicator"),
	$resizerSidebar = document.getElementById("resizer-sidebar"),
	$resizerSplit = document.getElementById("resizer-split"),
	$newBtn = document.getElementById("btn-new"),
	$deleteBtn = document.getElementById("btn-delete"),
	$closeBtn = document.getElementById("btn-close"),
	$copyBtn = document.getElementById("btn-copy"),
	$sidebar = document.getElementById("sidebar"),
	$editorSection = document.getElementById("editor-section"),
	$previewSection = document.getElementById("preview-section"),
	$splitView = document.querySelector(".split-view"),
	$notificationArea = document.getElementById("notification-area");

let ignoreScroll = false;

function notify(message, type = "info") {
	// notification
	const notificationEl = document.createElement("div");

	notificationEl.className = `toast ${type}`;

	// message
	const messageEl = document.createElement("span");

	messageEl.textContent = message;

	notificationEl.appendChild(messageEl);

	// icon
	const iconEl = document.createElement("i");

	if (type === "error") {
		iconEl.setAttribute("data-lucide", "alert-circle");
	} else {
		iconEl.setAttribute("data-lucide", "info");
	}

	notificationEl.prepend(iconEl);

	// append
	$notificationArea.appendChild(notificationEl);

	createIcons({
		icons: icons,
		attrs: {
			width: 16,
			height: 16,
		},
	});

	requestAnimationFrame(() => {
		notificationEl.classList.add("visible");
	});

	setTimeout(() => {
		notificationEl.classList.remove("visible");

		notificationEl.addEventListener("transitionend", () => {
			notificationEl.remove();
		});
	}, 3000);
}

async function api(method, path, body = null) {
	const headers = {
		Authorization: `Bearer ${state.token}`,
	};

	if (body) {
		headers["Content-Type"] = "application/json";
	}

	const response = await fetch(path, {
		method: method,
		headers: headers,
		body: body ? JSON.stringify(body) : null,
	});

	if (response.status === 403) {
		throw new Error("Auth");
	}

	if (!response.ok) {
		let msg = response.statusText;

		try {
			const data = await response.json();

			if (data.error) {
				msg = data.error;
			}
		} catch {}

		throw new Error(msg);
	}

	const text = await response.text();

	return text ? JSON.parse(text) : {};
}

function initResizer(handle, minWidth, getTargets) {
	let startX, startWidths;

	if (!handle) {
		return;
	}

	function onMove(event) {
		const { primary, secondary, container } = getTargets(),
			containerWidth = container.getBoundingClientRect().width,
			delta = event.clientX - startX;

		let newPrimaryWidth = startWidths.primary + delta;

		if (newPrimaryWidth < minWidth) {
			newPrimaryWidth = minWidth;
		}

		const maxPrimaryWidth = containerWidth - minWidth - handle.offsetWidth;

		if (newPrimaryWidth > maxPrimaryWidth) {
			newPrimaryWidth = maxPrimaryWidth;
		}

		primary.style.flex = `0 0 ${newPrimaryWidth}px`;
		secondary.style.flex = "1 1 0%";
	}

	function onUp() {
		handle.classList.remove("active");

		document.body.style.cursor = "";

		document.removeEventListener("mousemove", onMove);
		document.removeEventListener("mouseup", onUp);
	}

	handle.addEventListener("mousedown", event => {
		event.preventDefault();

		const { primary } = getTargets();

		startX = event.clientX;

		startWidths = {
			primary: primary.getBoundingClientRect().width,
		};

		handle.classList.add("active");

		document.body.style.cursor = "col-resize";

		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});
}

function showAuth() {
	$authLayer.classList.remove("hidden");

	$inputAuth.value = "";

	$inputAuth.focus();
}

async function verifySession() {
	try {
		const response = await api("GET", "/-/verify");

		$versionLabel.textContent = response.version || "";

		$authLayer.classList.add("hidden");

		loadNotes();
	} catch (err) {
		if (err.message === "Auth") {
			state.token = null;

			localStorage.removeItem("scratch_token");
		}

		showAuth();

		if (err.message !== "Auth") {
			$authError.textContent = "Connection failed";
		}
	}
}

async function login() {
	const token = $inputAuth.value.trim();

	if (!token) {
		return;
	}

	state.token = token;

	localStorage.setItem("scratch_token", token);

	$authError.textContent = "";

	await verifySession();
}

async function loadNotes() {
	try {
		state.notes = (await api("GET", "/-/list")) || [];

		renderSidebar();

		const savedId = parseInt(localStorage.getItem("scratch_active_note"), 10);

		if (savedId) {
			const exists = state.notes.some(_note => _note.id === savedId);

			if (exists) {
				selectNote(savedId);
			} else {
				localStorage.removeItem("scratch_active_note");
			}
		}
	} catch (err) {
		console.error(err);

		notify("Failed to load notes", "error");
	}
}

function renderSidebar() {
	$noteList.innerHTML = "";

	for (const note of state.notes) {
		// note
		const noteEl = document.createElement("div");

		noteEl.className = `note-item${note.id === state.activeNoteId ? " active" : ""}`;

		// title
		const titleEl = document.createElement("div");

		titleEl.className = "note-title";

		titleEl.textContent = note.title || "Untitled";

		noteEl.appendChild(titleEl);

		// date
		const dateEl = document.createElement("div");

		dateEl.className = "note-date";

		dateEl.textContent = new Date(note.updated_at * 1000).toLocaleString("en-GB", {
			month: "short",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});

		noteEl.appendChild(dateEl);

		// tags
		const tagsEl = document.createElement("div");

		tagsEl.className = "note-preview-tags";

		if (note.tags?.length) {
			for (const tag of note.tags) {
				const tagEl = document.createElement("span");

				tagEl.className = "mini-tag";

				tagEl.textContent = tag;

				tagsEl.appendChild(tagEl);
			}
		}

		noteEl.appendChild(tagsEl);

		// events
		noteEl.addEventListener("click", () => {
			selectNote(note.id);
		});

		$noteList.appendChild(noteEl);
	}
}

function selectNote(id) {
	state.activeNoteId = id;

	localStorage.setItem("scratch_active_note", id);

	const note = state.notes.find(_note => _note.id === id);

	if (!note) {
		return;
	}

	$emptyState.classList.add("hidden");
	$editorContainer.classList.remove("hidden");

	$inputTitle.value = note.title;
	$editorBody.value = note.body;

	renderTags(note.tags || []);

	renderPreview(note.body);

	state.lastSaved = {
		title: note.title,
		body: note.body,
		tags: note.tags,
	};

	renderSidebar();

	setStatus("READY");
}

function renderPreview(md) {
	$previewBody.innerHTML = DOMPurify.sanitize(marked.parse(md));
}

function sanitizeTag(raw) {
	return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function renderTags(tags) {
	$tagContainer.querySelectorAll(".tag-chip").forEach(container => {
		container.remove();
	});

	for (const tag of tags) {
		// tag
		const chip = document.createElement("div");

		chip.className = "tag-chip";

		chip.textContent = tag;

		// remove btn
		const remove = document.createElement("span");

		remove.textContent = "×";

		remove.addEventListener("click", () => {
			removeTag(tag);
		});

		chip.appendChild(remove);

		// append
		$tagContainer.insertBefore(chip, $inputTag);
	}
}

async function addTag(raw) {
	const tag = sanitizeTag(raw);

	$inputTag.value = "";

	if (!tag) {
		return;
	}

	const note = state.notes.find(_note => _note.id === state.activeNoteId);

	if (!note) {
		return;
	}

	if (!note.tags) {
		note.tags = [];
	}

	if (!note.tags.includes(tag)) {
		note.tags.push(tag);

		renderTags(note.tags);

		await saveIfDirty(true);
	}
}

async function removeTag(tag) {
	const note = state.notes.find(_note => _note.id === state.activeNoteId);

	if (!note || !note.tags) {
		return;
	}

	note.tags = note.tags.filter(_tag => _tag !== tag);

	renderTags(note.tags);

	await saveIfDirty(true);
}

function setStatus(msg, err = false) {
	$status.textContent = msg;

	$status.style.color = err ? "var(--red)" : "var(--overlay0)";
}

function isDirty(note) {
	const last = state.lastSaved;

	if (note.title !== last.title || note.body !== last.body) {
		return true;
	}

	if (note.tags.length !== last.tags.length) {
		return true;
	}

	const tagsAfter = note.tags.toSorted(),
		tagsBefore = last.tags.toSorted();

	return tagsAfter.some((tag, idx) => tag !== tagsBefore[idx]);
}

async function saveIfDirty(force = false) {
	if (!state.activeNoteId) {
		return;
	}

	const note = state.notes.find(_note => _note.id === state.activeNoteId);

	if (!note) {
		return;
	}

	note.title = $inputTitle.value;
	note.body = $editorBody.value;

	if (!force && !isDirty(note)) {
		return;
	}

	setStatus("SAVING...");

	try {
		await api("PUT", `/-/note/${note.id}`, {
			title: note.title,
			body: note.body,
			tags: note.tags,
		});

		note.updated_at = Math.floor(Date.now() / 1000);

		state.lastSaved = {
			title: note.title,
			body: note.body,
			tags: note.tags,
		};

		renderSidebar();

		setStatus("SAVED");
	} catch {
		setStatus("ERROR", true);
	}
}

function syncScroll(source, target) {
	if (ignoreScroll) {
		ignoreScroll = false;

		return;
	}

	const sourceMax = source.scrollHeight - source.clientHeight,
		targetMax = target.scrollHeight - target.clientHeight;

	if (sourceMax > 0 && targetMax > 0) {
		const percentage = source.scrollTop / sourceMax;

		ignoreScroll = true;

		target.scrollTop = percentage * targetMax;
	}
}

$editorBody.addEventListener("scroll", () => {
	syncScroll($editorBody, $previewBody);
});

$previewBody.addEventListener("scroll", () => {
	syncScroll($previewBody, $editorBody);
});

createIcons({
	icons: icons,
});

if (state.token) {
	verifySession();
} else {
	showAuth();
}

$loginBtn.addEventListener("click", () => {
	login();
});

$inputAuth.addEventListener("keydown", event => {
	if (event.key !== "Enter") {
		return;
	}

	login();
});

$logoutBtn.addEventListener("click", () => {
	localStorage.removeItem("scratch_token");
	localStorage.removeItem("scratch_active_note");

	location.reload();
});

$newBtn.addEventListener("click", async () => {
	if (state.busy) {
		return;
	}

	state.busy = true;

	try {
		const response = await api("POST", "/-/note", {
			title: "",
			body: "",
			tags: [],
		});

		await loadNotes();

		selectNote(response.id);

		$inputTitle.focus();
	} catch (err) {
		notify(err.message, "error");
	} finally {
		state.busy = false;
	}
});

$deleteBtn.addEventListener("click", async () => {
	if (state.busy) {
		return;
	}

	if (!state.activeNoteId || !confirm("Delete this note?")) {
		return;
	}

	state.busy = true;

	try {
		await api("DELETE", `/-/note/${state.activeNoteId}`);

		state.activeNoteId = null;

		localStorage.removeItem("scratch_active_note");

		$editorContainer.classList.add("hidden");
		$emptyState.classList.remove("hidden");

		await loadNotes();
	} catch (err) {
		notify(err.message, "error");
	} finally {
		state.busy = false;
	}
});

$closeBtn.addEventListener("click", () => {
	state.activeNoteId = null;

	localStorage.removeItem("scratch_active_note");

	$editorContainer.classList.add("hidden");
	$emptyState.classList.remove("hidden");

	renderSidebar();
});

$copyBtn.addEventListener("click", () => {
	navigator.clipboard.writeText($editorBody.value).then(() => {
		clearTimeout(state.copyTimeout);

		$copyBtn.innerHTML = `<i data-lucide="check"></i>`;

		createIcons({
			icons: icons,
		});

		state.copyTimeout = setTimeout(() => {
			$copyBtn.innerHTML = `<i data-lucide="copy"></i>`;

			createIcons({
				icons: icons,
			});
		}, 1200);
	});
});

$inputTitle.addEventListener("blur", () => {
	saveIfDirty();
});

$editorBody.addEventListener("blur", () => {
	saveIfDirty();
});

$editorBody.addEventListener("input", () => {
	renderPreview($editorBody.value);
});

$inputTag.addEventListener("keydown", event => {
	if (event.key !== "Enter" && event.key !== " " && event.key !== ",") {
		return;
	}

	event.preventDefault();

	addTag($inputTag.value);
});

$inputTag.addEventListener("blur", () => {
	addTag($inputTag.value);
});

initResizer($resizerSidebar, 200, () => ({
	primary: $sidebar,
	secondary: document.querySelector(".editor-pane"),
	container: document.querySelector(".layout"),
}));

initResizer($resizerSplit, 300, () => ({
	primary: $editorSection,
	secondary: $previewSection,
	container: $splitView,
}));
