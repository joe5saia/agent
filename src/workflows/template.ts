const templateVariablePattern = /\{\{\s*(parameters\.[a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Returns template parameter references inside a workflow prompt.
 */
export function listTemplateVariables(template: string): Array<string> {
	const variables = new Set<string>();
	for (const match of template.matchAll(templateVariablePattern)) {
		const variable = match[1];
		if (variable !== undefined) {
			variables.add(variable);
		}
	}
	return [...variables.values()];
}

/**
 * Expands {{parameters.name}} placeholders from workflow run parameters.
 */
export function expandTemplate(template: string, parameters: Record<string, unknown>): string {
	return template.replaceAll(templateVariablePattern, (_match, variable: string) => {
		const key = variable.replace("parameters.", "");
		if (!(key in parameters)) {
			throw new Error(`Unknown template variable: ${variable}`);
		}
		const value = parameters[key];
		if (value === undefined || value === null) {
			return "";
		}
		return String(value);
	});
}
