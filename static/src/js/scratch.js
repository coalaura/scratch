import "../css/scratch.css";

import DOMPurify from "dompurify";
import { marked } from "marked";

const state = {
	token: localStorage.getItem("scratch_token"),
	notes: [],
	folders: [],
	busy: false,
	activeNoteId: null,
	copyTimeout: null,
	selectController: null,
	draggedElement: null,
	lastSaved: {
		title: "",
		body: "",
		tags: [],
		version: "",
	},
	layout: {
		sidebarWidth: parseInt(localStorage.getItem("scratch_layout_sidebar_width"), 10) || 280,
		editorWidth: parseInt(localStorage.getItem("scratch_layout_editor_width"), 10) || 0,
		previewVisible: localStorage.getItem("scratch_layout_preview_visible") !== "false",
	},
};

const $authLayer = document.getElementById("auth-layer"),
	$appLoader = document.getElementById("app-loader"),
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
	$newFolderBtn = document.getElementById("btn-new-folder"),
	$deleteBtn = document.getElementById("btn-delete"),
	$closeBtn = document.getElementById("btn-close"),
	$copyBtn = document.getElementById("btn-copy"),
	$downloadBtn = document.getElementById("btn-download"),
	$openPreviewBtn = document.getElementById("btn-open-preview"),
	$closePreviewBtn = document.getElementById("btn-close-preview"),
	$sidebar = document.getElementById("sidebar"),
	$editorSection = document.getElementById("editor-section"),
	$previewSection = document.getElementById("preview-section"),
	$splitView = document.querySelector(".split-view"),
	$notificationArea = document.getElementById("notification-area"),
	$promptModal = document.getElementById("prompt-modal"),
	$promptTitle = document.getElementById("prompt-title"),
	$inputPrompt = document.getElementById("input-prompt"),
	$btnPromptCancel = document.getElementById("btn-prompt-cancel"),
	$btnPromptConfirm = document.getElementById("btn-prompt-confirm"),
	$confirmModal = document.getElementById("confirm-modal"),
	$confirmTitle = document.getElementById("confirm-title"),
	$confirmMessage = document.getElementById("confirm-message"),
	$btnConfirmCancel = document.getElementById("btn-confirm-cancel"),
	$btnConfirmOk = document.getElementById("btn-confirm-ok");

let ignoreScroll = false;

function showConfirm(title, message) {
	return new Promise(resolve => {
		$confirmTitle.textContent = title;

		$confirmMessage.textContent = message;

		$confirmModal.classList.remove("hidden");

		$btnConfirmOk.focus();

		const cleanup = () => {
			$confirmModal.classList.add("hidden");

			$btnConfirmCancel.removeEventListener("click", onCancel);
			$btnConfirmOk.removeEventListener("click", onConfirm);

			document.removeEventListener("keydown", onKeydown);
		};

		const onCancel = () => {
			cleanup();

			resolve(false);
		};

		const onConfirm = () => {
			cleanup();

			resolve(true);
		};

		const onKeydown = event => {
			if (event.key === "Escape") {
				onCancel();
			}
		};

		$btnConfirmCancel.addEventListener("click", onCancel);
		$btnConfirmOk.addEventListener("click", onConfirm);

		document.addEventListener("keydown", onKeydown);
	});
}

function showPrompt(title, defaultText = "") {
	return new Promise(resolve => {
		$promptTitle.textContent = title;

		$inputPrompt.value = defaultText;

		$promptModal.classList.remove("hidden");

		$inputPrompt.focus();
		$inputPrompt.select();

		const cleanup = () => {
			$promptModal.classList.add("hidden");

			$btnPromptCancel.removeEventListener("click", onCancel);
			$btnPromptConfirm.removeEventListener("click", onConfirm);

			document.removeEventListener("keydown", onKeydown);
		};

		const onCancel = () => {
			cleanup();

			resolve(null);
		};

		const onConfirm = () => {
			cleanup();

			resolve($inputPrompt.value);
		};

		const onKeydown = event => {
			if (event.key === "Enter") {
				onConfirm();
			} else if (event.key === "Escape") {
				onCancel();
			}
		};

		$btnPromptCancel.addEventListener("click", onCancel);
		$btnPromptConfirm.addEventListener("click", onConfirm);

		document.addEventListener("keydown", onKeydown);
	});
}

function notify(message, type = "info") {
	const notificationEl = document.createElement("div");

	notificationEl.className = `toast ${type}`;

	const messageEl = document.createElement("span");

	messageEl.textContent = message;

	notificationEl.appendChild(messageEl);

	const iconEl = document.createElement("i");

	iconEl.className = `icon icon-${type === "error" ? "alert" : "info"}`;

	notificationEl.prepend(iconEl);

	$notificationArea.appendChild(notificationEl);

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

async function api(method, path, body = null, opts = {}) {
	const headers = {
		Authorization: `Bearer ${state.token}`,
	};

	if (body) {
		headers["Content-Type"] = "application/json";
	}

	let timeoutId,
		signal = opts.signal;

	if (!signal) {
		const controller = new AbortController();

		signal = controller.signal;

		timeoutId = setTimeout(() => controller.abort(), 15000);
	}

	try {
		const response = await fetch(path, {
			method: method,
			headers: headers,
			body: body ? JSON.stringify(body) : null,
			...opts,
			signal: signal,
		});

		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		if (response.status === 403) {
			throw new Error("Auth");
		}

		if (response.status === 409) {
			throw new Error("Conflict");
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
	} catch (err) {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		if (err.name === "AbortError") {
			throw new Error("Request timed out");
		}

		throw err;
	}
}

function setLoading(element, loading) {
	element.classList.toggle("is-loading", loading);
}

function formatBytes(bytes) {
	if (!+bytes) {
		return "0B";
	}

	const sizes = ["B", "kB", "MB", "GB", "TB"],
		i = Math.floor(Math.log(bytes) / Math.log(1000));

	const val = bytes / Math.pow(1000, i),
		dec = i === 0 ? 0 : val < 10 ? 2 : 1;

	return `${val.toFixed(dec)}${sizes[i]}`;
}

function initResizer(handle, minWidth, getTargets, onStop) {
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

		if (onStop) {
			onStop();
		}
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
	$appLoader.classList.remove("hidden");

	try {
		const response = await api("GET", "/-/verify");

		$versionLabel.textContent = response.version || "";

		$authLayer.classList.add("hidden");
		$appLoader.classList.add("hidden");

		loadNotes();
	} catch (err) {
		$appLoader.classList.add("hidden");

		if (err.message === "Auth") {
			state.token = null;

			localStorage.removeItem("scratch_token");
		}

		showAuth();

		if (err.message !== "Auth") {
			$authError.textContent = err.message === "Request timed out" ? "Connection timed out" : "Connection failed";
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
	setLoading($sidebar, true);

	try {
		const [notes, folders] = await Promise.all([api("GET", "/-/notes"), api("GET", "/-/folders")]);

		state.notes = notes || [];
		state.folders = folders || [];

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
	} finally {
		setLoading($sidebar, false);
	}
}

function renderSidebar() {
	$noteList.innerHTML = "";

	const noteMap = new Map();

	for (const folder of state.folders) {
		noteMap.set(folder.id, []);
	}

	noteMap.set(0, []); // 0 or null for root notes

	for (const note of state.notes) {
		const fId = note.folder_id || 0;

		if (noteMap.has(fId)) {
			noteMap.get(fId).push(note);
		} else {
			noteMap.get(0).push(note);
		}
	}

	state.folders.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

	for (const folder of state.folders) {
		$noteList.appendChild(createFolderItem(folder, noteMap.get(folder.id)));
	}

	for (const note of noteMap.get(0)) {
		$noteList.appendChild(createNoteItem(note));
	}
}

function createFolderItem(folder, notes) {
	const folderContainer = document.createElement("div");

	folderContainer.className = "folder-container";
	folderContainer.dataset.folderId = String(folder.id);
	folderContainer.draggable = true;

	folderContainer.addEventListener("dragstart", event => {
		if (event.target !== folderContainer) {
			return;
		}

		event.dataTransfer.setData("application/x-folder-id", String(folder.id));
		event.dataTransfer.effectAllowed = "move";

		state.draggedElement = folderContainer;

		requestAnimationFrame(() => {
			folderContainer.classList.add("is-dragging");
		});
	});

	folderContainer.addEventListener("dragend", () => {
		folderContainer.classList.remove("is-dragging");

		state.draggedElement = null;
	});

	const folderEl = document.createElement("div");

	folderEl.className = `folder-item ${folder.is_expanded ? "expanded" : ""}`;
	folderEl.dataset.folderId = String(folder.id);

	const folderTitle = document.createElement("div");

	folderTitle.className = "folder-title";
	folderTitle.innerHTML = `<i class="icon-chevron"></i><span>${folder.name || "New Folder"}</span>`;

	const folderActions = document.createElement("div");

	folderActions.className = "folder-actions";

	const folderRename = document.createElement("button");

	folderRename.className = "folder-action";
	folderRename.innerHTML = `<i class="icon icon-edit"></i>`;
	folderRename.title = "Rename Folder";

	const folderDelete = document.createElement("button");

	folderDelete.className = "folder-action danger";
	folderDelete.innerHTML = `<i class="icon icon-trash"></i>`;
	folderDelete.title = "Delete Folder";

	folderActions.appendChild(folderRename);
	folderActions.appendChild(folderDelete);

	folderEl.appendChild(folderTitle);
	folderEl.appendChild(folderActions);

	const contentEl = document.createElement("div");

	contentEl.className = `folder-content ${folder.is_expanded ? "expanded" : ""}`;

	for (const note of notes) {
		contentEl.appendChild(createNoteItem(note));
	}

	folderContainer.appendChild(folderEl);
	folderContainer.appendChild(contentEl);

	folderEl.addEventListener("click", async event => {
		if (event.target.closest(".folder-actions")) {
			return;
		}

		const isExpanded = folderEl.classList.contains("expanded"),
			newExpandedState = !isExpanded;

		folderEl.classList.toggle("expanded");
		contentEl.classList.toggle("expanded");

		folder.is_expanded = newExpandedState;

		try {
			const response = await api("PUT", `/-/folder/${folder.id}`, {
				version: folder.version,
				is_expanded: newExpandedState,
			});

			folder.version = response.version;
		} catch {
			folderEl.classList.toggle("expanded");
			contentEl.classList.toggle("expanded");

			folder.is_expanded = isExpanded;

			notify("Failed to save folder state", "error");
		}
	});

	folderRename.addEventListener("click", async event => {
		event.stopPropagation();

		if (state.busy) {
			return;
		}

		const newName = await showPrompt("Rename folder:", folder.name);

		if (newName === null || !newName.trim() || newName.trim() === folder.name) {
			return;
		}

		state.busy = true;

		setLoading($sidebar, true);

		try {
			const response = await api("PUT", `/-/folder/${folder.id}`, {
				version: folder.version,
				name: newName.trim(),
			});

			folder.name = newName.trim();
			folder.version = response.version;

			renderSidebar();
		} catch (err) {
			notify(err.message, "error");
		} finally {
			state.busy = false;

			setLoading($sidebar, false);
		}
	});

	folderDelete.addEventListener("click", async event => {
		event.stopPropagation();

		const confirmed = await showConfirm("Delete Folder", `Delete folder "${folder.name}"? Notes inside will be moved to the root level.`);

		if (!confirmed) {
			return;
		}

		if (state.busy) {
			return;
		}

		state.busy = true;

		setLoading($sidebar, true);

		try {
			await api("DELETE", `/-/folder/${folder.id}`, {
				version: folder.version,
			});

			state.folders = state.folders.filter(_folder => _folder.id !== folder.id);

			for (const note of state.notes) {
				if (note.folder_id === folder.id) {
					note.folder_id = 0;
				}
			}

			renderSidebar();
		} catch (err) {
			notify(err.message, "error");
		} finally {
			state.busy = false;

			setLoading($sidebar, false);
		}
	});

	folderEl.addEventListener("dragover", event => {
		event.preventDefault();

		if (state.draggedElement?.classList.contains("folder-container")) {
			return;
		}

		folderEl.classList.add("drag-over");
	});

	folderEl.addEventListener("dragleave", () => {
		folderEl.classList.remove("drag-over");
	});

	return folderContainer;
}

async function moveFolder(folderId, newSortOrder) {
	const folder = state.folders.find(_folder => _folder.id === folderId);

	if (!folder) {
		return;
	}

	try {
		const response = await api("PUT", `/-/folder/${folderId}`, {
			version: folder.version,
			sort_order: newSortOrder,
		});

		if (response.needs_cleanup) {
			await loadNotes();

			return;
		}

		folder.version = response.version;
		folder.sort_order = newSortOrder;

		renderSidebar();
	} catch {
		notify("Failed to move folder", "error");
	}
}

async function moveNoteToFolder(noteId, folderId, newSortOrder = null) {
	const note = state.notes.find(n => n.id === noteId);

	if (!note || (note.folder_id === folderId && newSortOrder === null)) {
		return;
	}

	try {
		const payload = {
			version: note.version,
			folder_id: folderId,
		};

		if (newSortOrder !== null) {
			payload.sort_order = newSortOrder;
		}

		const response = await api("PUT", `/-/note/${noteId}`, payload);

		if (response.needs_cleanup) {
			await loadNotes();

			return;
		}

		note.version = response.version;
		note.folder_id = folderId;

		if (newSortOrder !== null) {
			note.sort_order = newSortOrder;

			state.notes.sort((a, b) => a.sort_order - b.sort_order || b.created_at - a.created_at);
		}

		renderSidebar();
	} catch {
		notify("Failed to move note", "error");
	}
}

function createNoteItem(note) {
	const noteEl = document.createElement("div");

	noteEl.dataset.noteId = String(note.id);
	noteEl.className = `note-item${note.id === state.activeNoteId ? " active" : ""}`;
	noteEl.draggable = true;

	noteEl.addEventListener("dragstart", event => {
		event.dataTransfer.setData("text/plain", String(note.id));
		event.dataTransfer.effectAllowed = "move";

		state.draggedElement = noteEl;

		requestAnimationFrame(() => {
			noteEl.classList.add("is-dragging");
		});
	});

	noteEl.addEventListener("dragend", () => {
		noteEl.classList.remove("is-dragging");

		state.draggedElement = null;
	});

	const titleEl = document.createElement("div");

	titleEl.className = "note-title";

	titleEl.textContent = note.title || "Untitled";

	noteEl.appendChild(titleEl);

	const sizeEl = document.createElement("div");

	sizeEl.className = "note-size";

	sizeEl.textContent = formatBytes(note.size || 0);

	noteEl.appendChild(sizeEl);

	const dateEl = document.createElement("div");

	dateEl.className = "note-date";

	dateEl.textContent = new Date(note.updated_at * 1000).toLocaleString("en-GB", {
		month: "short",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});

	noteEl.appendChild(dateEl);

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

	return noteEl;
}

function updateActiveNoteClass(prevId, newId) {
	if (prevId) {
		const prevEl = $noteList.querySelector(`.note-item[data-note-id="${prevId}"]`);

		if (prevEl) {
			prevEl.classList.remove("active");
		}
	}

	if (newId) {
		const newEl = $noteList.querySelector(`.note-item[data-note-id="${newId}"]`);

		if (newEl) {
			newEl.classList.add("active");
		}
	}
}

function captureCurrentNote() {
	if (!state.activeNoteId) {
		return null;
	}

	const note = state.notes.find(_note => _note.id === state.activeNoteId);

	if (!note) {
		return null;
	}

	return {
		id: state.activeNoteId,
		title: $inputTitle.value,
		body: $editorBody.value,
		tags: note.tags ? [...note.tags] : [],
		version: note.version,
	};
}

function isDirty(snapshot) {
	const last = state.lastSaved;

	if (snapshot.title !== last.title || snapshot.body !== last.body) {
		return true;
	}

	if (snapshot.tags?.length !== last.tags?.length) {
		return true;
	}

	if (!snapshot.tags) {
		return false;
	}

	const tagsAfter = snapshot.tags.toSorted(),
		tagsBefore = last.tags.toSorted();

	return tagsAfter.some((tag, idx) => tag !== tagsBefore[idx]);
}

async function saveSnapshot(snapshot) {
	if (!snapshot || !isDirty(snapshot)) {
		return;
	}

	const note = state.notes.find(_note => _note.id === snapshot.id);

	if (!note) {
		return;
	}

	note.title = snapshot.title;
	note.body = snapshot.body;
	note.tags = snapshot.tags;

	setStatus("SAVING...");

	try {
		const response = await api("PUT", `/-/note/${snapshot.id}`, {
			version: snapshot.version,
			title: snapshot.title,
			body: snapshot.body,
			tags: snapshot.tags,
		});

		note.version = response.version;
		note.updated_at = Math.floor(Date.now() / 1000);

		if (snapshot.id === state.activeNoteId) {
			state.lastSaved = {
				title: snapshot.title,
				body: snapshot.body,
				tags: snapshot.tags,
				version: response.version,
			};
		}

		renderSidebar();

		setStatus("SAVED");
	} catch (err) {
		if (err.message === "Conflict") {
			setStatus("CONFLICT", true);

			notify("Note was modified elsewhere. Please reload.", "error");
		} else {
			setStatus("ERROR", true);
		}
	}
}

async function saveCurrentNote() {
	const snapshot = captureCurrentNote();

	await saveSnapshot(snapshot);
}

async function closeNote() {
	const snapshot = captureCurrentNote();

	const prevId = state.activeNoteId;

	state.activeNoteId = null;

	localStorage.removeItem("scratch_active_note");

	$editorContainer.classList.add("hidden");
	$emptyState.classList.remove("hidden");

	updateActiveNoteClass(prevId, null);

	await saveSnapshot(snapshot);
}

async function selectNote(id, skipLoading = false) {
	if (state.activeNoteId === id) {
		return;
	}

	const snapshot = captureCurrentNote(),
		prevId = state.activeNoteId;

	state.activeNoteId = id;

	localStorage.setItem("scratch_active_note", id);

	const note = state.notes.find(_note => _note.id === id);

	if (!note) {
		return;
	}

	state.selectController?.abort();

	const controller = new AbortController();

	state.selectController = controller;

	$emptyState.classList.add("hidden");
	$editorContainer.classList.remove("hidden");

	$inputTitle.value = note.title || "";
	$editorBody.value = "";

	renderTags(note.tags || []);

	renderPreview("");

	updateActiveNoteClass(prevId, id);

	saveSnapshot(snapshot);

	if (!skipLoading) {
		$splitView.classList.add("loading");

		try {
			const fullNote = await api("GET", `/-/note/${id}`, null, {
				signal: controller.signal,
			});

			if (state.activeNoteId !== id) {
				return;
			}

			Object.assign(note, fullNote);
		} catch (err) {
			if (controller.signal.aborted) {
				return;
			}

			$splitView.classList.remove("loading");

			console.error(err);

			notify("Failed to load note", "error");

			return;
		}

		$splitView.classList.remove("loading");
	}

	$inputTitle.value = note.title;
	$editorBody.value = note.body;

	renderTags(note.tags || []);

	renderPreview(note.body);

	state.lastSaved = {
		title: note.title,
		body: note.body,
		tags: note.tags || [],
		version: note.version,
	};

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
		const chip = document.createElement("div");

		chip.className = "tag-chip";

		chip.textContent = tag;

		const remove = document.createElement("span");

		remove.textContent = "×";

		remove.addEventListener("click", () => {
			removeTag(tag);
		});

		chip.appendChild(remove);

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

		await saveCurrentNote();
	}
}

async function removeTag(tag) {
	const note = state.notes.find(_note => _note.id === state.activeNoteId);

	if (!note || !note.tags) {
		return;
	}

	note.tags = note.tags.filter(_tag => _tag !== tag);

	renderTags(note.tags);

	await saveCurrentNote();
}

function setStatus(msg, err = false) {
	$status.textContent = msg;

	$status.style.color = err ? "var(--red)" : "var(--overlay0)";
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

function updatePreviewVisibility() {
	if (state.layout.previewVisible) {
		$previewSection.classList.remove("hidden");
		$resizerSplit.classList.remove("hidden");
		$openPreviewBtn.classList.add("hidden");

		if (state.layout.editorWidth > 0) {
			$editorSection.style.flex = `0 0 ${state.layout.editorWidth}px`;
		} else {
			$editorSection.style.flex = "1 1 50%";
		}

		renderPreview($editorBody.value);
	} else {
		$previewSection.classList.add("hidden");
		$resizerSplit.classList.add("hidden");
		$openPreviewBtn.classList.remove("hidden");

		$editorSection.style.flex = "1";
	}

	localStorage.setItem("scratch_layout_preview_visible", state.layout.previewVisible);
}

function restoreLayout() {
	if (state.layout.sidebarWidth) {
		$sidebar.style.flex = `0 0 ${state.layout.sidebarWidth}px`;
	}

	updatePreviewVisibility();
}

$editorBody.addEventListener("scroll", () => {
	syncScroll($editorBody, $previewBody);
});

$previewBody.addEventListener("scroll", () => {
	syncScroll($previewBody, $editorBody);
});

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

$newFolderBtn.addEventListener("click", async () => {
	if (state.busy || $sidebar.classList.contains("is-loading")) {
		return;
	}

	state.busy = true;

	try {
		const name = await showPrompt("Enter folder name:", "New Folder");

		if (name === null || !name.trim()) {
			state.busy = false;

			return;
		}

		setLoading($sidebar, true);

		const response = await api("POST", "/-/folder", {
			name: name.trim(),
		});

		state.folders.push({
			id: response.id,
			name: name.trim(),
			version: response.version,
			sort_order: response.sort_order || 0,
			updated_at: Math.floor(Date.now() / 1000),
		});

		renderSidebar();
	} catch (err) {
		notify(err.message, "error");
	} finally {
		state.busy = false;

		setLoading($sidebar, false);
	}
});

$noteList.addEventListener("dragover", event => {
	event.preventDefault();

	if (!state.draggedElement) {
		return;
	}

	document.querySelectorAll(".drag-before, .drag-after").forEach(el => {
		el.classList.remove("drag-before", "drag-after");
	});

	if (state.draggedElement.classList.contains("folder-container")) {
		const folderContainer = event.target.closest(".folder-container");

		if (folderContainer && folderContainer !== state.draggedElement) {
			const rect = folderContainer.getBoundingClientRect();

			if (event.clientY < rect.top + rect.height / 2) {
				folderContainer.classList.add("drag-before");
			} else {
				folderContainer.classList.add("drag-after");
			}
		}

		return;
	}

	const folderItem = event.target.closest(".folder-item");

	if (folderItem) {
		return; // Handled by folder's own dragover
	}

	const noteItem = event.target.closest(".note-item");

	if (noteItem && noteItem !== state.draggedElement) {
		const rect = noteItem.getBoundingClientRect();

		if (event.clientY < rect.top + rect.height / 2) {
			noteItem.classList.add("drag-before");
		} else {
			noteItem.classList.add("drag-after");
		}
	}
});

$noteList.addEventListener("dragleave", event => {
	const target = event.target.closest(".note-item, .folder-container");

	if (target) {
		target.classList.remove("drag-before", "drag-after");
	}
});

$noteList.addEventListener("drop", async event => {
	event.preventDefault();

	document.querySelectorAll(".drag-over").forEach(el => {
		el.classList.remove("drag-over");
	});

	const targetNoteEl = document.querySelector(".note-item.drag-before, .note-item.drag-after"),
		targetFolderContainerEl = document.querySelector(".folder-container.drag-before, .folder-container.drag-after");

	const isBefore = targetNoteEl ? targetNoteEl.classList.contains("drag-before") : targetFolderContainerEl ? targetFolderContainerEl.classList.contains("drag-before") : false;

	document.querySelectorAll(".drag-before, .drag-after").forEach(el => {
		el.classList.remove("drag-before", "drag-after");
	});

	if (!state.draggedElement) {
		return;
	}

	const draggedEl = state.draggedElement;

	state.draggedElement.classList.remove("is-dragging");
	state.draggedElement = null;

	if (draggedEl.classList.contains("folder-container")) {
		const folderId = parseInt(draggedEl.dataset.folderId, 10);

		if (!folderId) {
			return;
		}

		if (targetFolderContainerEl) {
			const targetFolderId = parseInt(targetFolderContainerEl.dataset.folderId, 10);

			if (targetFolderId === folderId) {
				return;
			}

			const folderEls = Array.from($noteList.children).filter(el => el.classList.contains("folder-container") && el !== draggedEl);

			const targetIndex = folderEls.indexOf(targetFolderContainerEl),
				insertIndex = isBefore ? targetIndex : targetIndex + 1;

			let newSortOrder = 0;

			const prevEl = folderEls[insertIndex - 1],
				nextEl = folderEls[insertIndex];

			let prevFolder = null,
				nextFolder = null;

			if (prevEl) {
				prevFolder = state.folders.find(_folder => _folder.id === parseInt(prevEl.dataset.folderId, 10));
			}

			if (nextEl) {
				nextFolder = state.folders.find(_folder => _folder.id === parseInt(nextEl.dataset.folderId, 10));
			}

			if (prevFolder && nextFolder) {
				newSortOrder = (prevFolder.sort_order + nextFolder.sort_order) / 2;
			} else if (prevFolder) {
				newSortOrder = prevFolder.sort_order + 1024;
			} else if (nextFolder) {
				newSortOrder = nextFolder.sort_order - 1024;
			}

			await moveFolder(folderId, newSortOrder);
		}

		return;
	}

	const noteId = parseInt(draggedEl.dataset.noteId, 10);

	if (!noteId) {
		return;
	}

	const targetFolderEl = event.target.closest(".folder-item");

	if (targetFolderEl) {
		const targetFolderId = parseInt(targetFolderEl.dataset.folderId, 10);

		await moveNoteToFolder(noteId, targetFolderId);

		return;
	}

	if (targetNoteEl) {
		const targetNoteId = parseInt(targetNoteEl.dataset.noteId, 10),
			targetNote = state.notes.find(n => n.id === targetNoteId);

		if (targetNote) {
			const container = targetNoteEl.parentElement;

			let targetFolderId = 0;

			if (container.classList.contains("folder-content")) {
				const folderContainer = container.closest(".folder-container");

				if (folderContainer) {
					targetFolderId = parseInt(folderContainer.dataset.folderId, 10);
				}
			}

			const noteEls = Array.from(container.children).filter(el => el.classList.contains("note-item") && el !== draggedEl);

			const targetIndex = noteEls.indexOf(targetNoteEl),
				insertIndex = isBefore ? targetIndex : targetIndex + 1;

			let newSortOrder = 0;

			const prevEl = noteEls[insertIndex - 1],
				nextEl = noteEls[insertIndex];

			let prevNote = null,
				nextNote = null;

			if (prevEl) {
				prevNote = state.notes.find(n => n.id === parseInt(prevEl.dataset.noteId, 10));
			}

			if (nextEl) {
				nextNote = state.notes.find(n => n.id === parseInt(nextEl.dataset.noteId, 10));
			}

			if (prevNote && nextNote) {
				newSortOrder = (prevNote.sort_order + nextNote.sort_order) / 2;
			} else if (prevNote) {
				newSortOrder = prevNote.sort_order + 1024;
			} else if (nextNote) {
				newSortOrder = nextNote.sort_order - 1024;
			}

			await moveNoteToFolder(noteId, targetFolderId, newSortOrder);
		}

		return;
	}

	if (event.target === $noteList) {
		await moveNoteToFolder(noteId, 0);
	}
});

$newBtn.addEventListener("click", async () => {
	if (state.busy || $sidebar.classList.contains("is-loading")) {
		return;
	}

	state.busy = true;

	setLoading($sidebar, true);

	try {
		const response = await api("POST", "/-/note", {
			title: "",
			body: "",
			tags: [],
		});

		state.notes.unshift({
			id: response.id,
			folder_id: 0,
			title: "",
			body: "",
			tags: [],
			version: response.version,
			sort_order: response.sort_order || 0,
			size: 0,
			updated_at: Math.floor(Date.now() / 1000),
		});

		renderSidebar();

		selectNote(response.id, true);

		$inputTitle.focus();
	} catch (err) {
		notify(err.message, "error");
	} finally {
		state.busy = false;

		setLoading($sidebar, false);
	}
});

$deleteBtn.addEventListener("click", async () => {
	if (state.busy) {
		return;
	}

	if (!state.activeNoteId) {
		return;
	}

	const confirmed = await showConfirm("Delete Note", "Delete this note? This action cannot be undone.");

	if (!confirmed) {
		return;
	}

	const note = state.notes.find(_note => _note.id === state.activeNoteId);

	if (!note) {
		return;
	}

	state.busy = true;

	setLoading($editorContainer, true);

	try {
		await api("DELETE", `/-/note/${state.activeNoteId}`, {
			version: note.version,
		});

		const deletedId = state.activeNoteId;

		state.activeNoteId = null;

		localStorage.removeItem("scratch_active_note");

		state.notes = state.notes.filter(nt => nt.id !== deletedId);

		renderSidebar();

		$editorContainer.classList.add("hidden");
		$emptyState.classList.remove("hidden");
	} catch (err) {
		if (err.message === "Conflict") {
			notify("Note was modified elsewhere. Please reload.", "error");
		} else {
			notify(err.message, "error");
		}
	} finally {
		state.busy = false;

		setLoading($editorContainer, false);
	}
});

$closeBtn.addEventListener("click", () => {
	closeNote();
});

$copyBtn.addEventListener("click", () => {
	navigator.clipboard.writeText($editorBody.value).then(() => {
		clearTimeout(state.copyTimeout);

		const icon = $copyBtn.querySelector(".icon");

		if (icon) {
			icon.classList.remove("icon-copy");
			icon.classList.add("icon-check");
		}

		state.copyTimeout = setTimeout(() => {
			if (!icon) {
				return;
			}

			icon.classList.remove("icon-check");
			icon.classList.add("icon-copy");
		}, 1200);
	});
});

$downloadBtn.addEventListener("click", () => {
	let name = $inputTitle.value
		.trim()
		.replace(/^[^\w]+|[^\w]+$/gm, "")
		.replace(/[^\w]+/, "_");

	if (!name) {
		name = "document";
	}

	const blob = new Blob([$editorBody.value], {
		type: "text/markdown",
	});

	const a = document.createElement("a"),
		url = URL.createObjectURL(blob);

	a.download = `${name}.md`;
	a.style.display = "none";
	a.href = url;

	document.body.appendChild(a);

	a.click();

	document.body.removeChild(a);
	URL.revokeObjectURL(url);
});

$openPreviewBtn.addEventListener("click", () => {
	state.layout.previewVisible = true;

	updatePreviewVisibility();
});

$closePreviewBtn.addEventListener("click", () => {
	state.layout.previewVisible = false;

	updatePreviewVisibility();
});

$inputTitle.addEventListener("blur", () => {
	saveCurrentNote();
});

$editorBody.addEventListener("blur", () => {
	saveCurrentNote();
});

$editorBody.addEventListener("input", () => {
	if (state.layout.previewVisible) {
		renderPreview($editorBody.value);
	}

	const note = state.notes.find(_note => _note.id === state.activeNoteId);

	if (note) {
		note.size = new TextEncoder().encode($editorBody.value).length;

		const sizeEl = $noteList.querySelector(".note-item.active .note-size");

		if (sizeEl) {
			sizeEl.textContent = formatBytes(note.size);
		}
	}
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

$noteList.addEventListener("click", event => {
	const item = event.target.closest(".note-item");

	if (!item) {
		return;
	}

	const id = parseInt(item.dataset.noteId, 10);

	if (!id) {
		return;
	}

	if (state.activeNoteId === id) {
		closeNote();

		return;
	}

	selectNote(id);
});

if (state.token) {
	verifySession();
} else {
	$appLoader.classList.add("hidden");

	showAuth();
}

restoreLayout();

initResizer(
	$resizerSidebar,
	200,
	() => ({
		primary: $sidebar,
		secondary: document.querySelector(".editor-pane"),
		container: document.querySelector(".layout"),
	}),
	() => {
		const width = $sidebar.getBoundingClientRect().width;

		state.layout.sidebarWidth = width;

		localStorage.setItem("scratch_layout_sidebar_width", width);
	}
);

initResizer(
	$resizerSplit,
	300,
	() => ({
		primary: $editorSection,
		secondary: $previewSection,
		container: $splitView,
	}),
	() => {
		const width = $editorSection.getBoundingClientRect().width;

		state.layout.editorWidth = width;

		localStorage.setItem("scratch_layout_editor_width", width);
	}
);
