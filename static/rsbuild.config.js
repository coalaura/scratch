import { defineConfig } from "@rsbuild/core";

export default defineConfig({
	html: {
		template: "./src/index.html",
	},
	source: {
		entry: {
			index: "./src/js/scratch.js",
		},
	},
	output: {
		distPath: {
			root: "./dist",
		},
	},
});
