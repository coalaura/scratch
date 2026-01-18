import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";

// Custom theme for tech-spec look
const scratchTheme = EditorView.theme({
	"&": {
		color: "#e4e4e7",
		backgroundColor: "#09090b",
	},
	".cm-content": {
		caretColor: "#22d3ee",
		padding: "2rem 2rem",
	},
	"&.cm-focused .cm-cursor": {
		borderLeftColor: "#22d3ee",
	},
	".cm-activeLine": {
		backgroundColor: "#18181b",
	},
	".cm-gutters": {
		backgroundColor: "#09090b",
		color: "#52525b",
		border: "none",
	},
	// Styling Markdown elements specifically
	".cm-header": {
		color: "#22d3ee",
		fontWeight: "bold",
	},
	".cm-header-1": { fontSize: "1.6em" },
	".cm-header-2": { fontSize: "1.4em" },
	".cm-header-3": { fontSize: "1.2em" },
	".cm-strong": { fontWeight: "bold", color: "#fff" },
	".cm-link": { color: "#22d3ee", textDecoration: "underline" },
	".cm-code": {
		fontFamily: "JetBrains Mono, monospace",
		backgroundColor: "#27272a",
		borderRadius: "3px",
		padding: "0 3px",
	},
});

let view = null;
let onUpdateCallback = null;

export const Editor = {
	init: (parentElement, onUpdate) => {
		onUpdateCallback = onUpdate;

		const state = EditorState.create({
			doc: "",
			extensions: [
				basicSetup,
				markdown({ base: markdownLanguage, codeLanguages: languages }),
				scratchTheme,
				EditorView.lineWrapping,
				EditorView.domEventHandlers({
					blur: (_event, eView) => {
						if (onUpdateCallback) {
							onUpdateCallback(eView.state.doc.toString());
						}
					},
				}),
			],
		});

		view = new EditorView({
			state: state,
			parent: parentElement,
		});
	},

	setDoc: text => {
		if (!view) {
			return;
		}
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: text },
		});
	},

	getDoc: () => (view ? view.state.doc.toString() : ""),

	destroy: () => {
		if (view) {
			view.destroy();
		}
	},
};
