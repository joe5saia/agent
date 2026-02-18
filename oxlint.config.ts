import nkzw from "@nkzw/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
	extends: [nkzw],
	ignorePatterns: ["dist", "coverage"],
	rules: {
		"@typescript-eslint/no-explicit-any": "error",
	},
});
