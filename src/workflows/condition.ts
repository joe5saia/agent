interface Token {
	kind:
		| "&&"
		| "("
		| ")"
		| "!"
		| "!="
		| "=="
		| "||"
		| "boolean"
		| "identifier"
		| "number"
		| "string";
	value: string;
}

class ConditionParser {
	readonly #parameters: Record<string, unknown>;
	#position = 0;
	readonly #tokens: Array<Token>;

	public constructor(expression: string, parameters: Record<string, unknown>) {
		this.#tokens = tokenize(expression);
		this.#parameters = parameters;
	}

	public parse(): boolean {
		const result = this.#parseOr();
		if (this.#peek() !== undefined) {
			throw new Error("Unexpected trailing tokens");
		}
		if (typeof result !== "boolean") {
			throw new Error("Condition did not evaluate to boolean");
		}
		return result;
	}

	#parseOr(): unknown {
		let left = this.#parseAnd();
		while (this.#accept("||")) {
			const right = this.#parseAnd();
			left = Boolean(left) || Boolean(right);
		}
		return left;
	}

	#parseAnd(): unknown {
		let left = this.#parseEquality();
		while (this.#accept("&&")) {
			const right = this.#parseEquality();
			left = Boolean(left) && Boolean(right);
		}
		return left;
	}

	#parseEquality(): unknown {
		let left = this.#parseUnary();
		while (true) {
			if (this.#accept("==")) {
				const right = this.#parseUnary();
				left = left === right;
				continue;
			}
			if (this.#accept("!=")) {
				const right = this.#parseUnary();
				left = left !== right;
				continue;
			}
			break;
		}
		return left;
	}

	#parseUnary(): unknown {
		if (this.#accept("!")) {
			return !this.#parseUnary();
		}
		return this.#parsePrimary();
	}

	#parsePrimary(): unknown {
		const next = this.#peek();
		if (next === undefined) {
			throw new Error("Unexpected end of expression");
		}

		if (this.#accept("(")) {
			const value = this.#parseOr();
			this.#expect(")");
			return value;
		}

		if (next.kind === "boolean") {
			this.#position += 1;
			return next.value === "true";
		}
		if (next.kind === "number") {
			this.#position += 1;
			return Number(next.value);
		}
		if (next.kind === "string") {
			this.#position += 1;
			return next.value;
		}
		if (next.kind === "identifier") {
			this.#position += 1;
			if (!next.value.startsWith("parameters.")) {
				throw new Error("Only parameters.<name> references are allowed");
			}
			const key = next.value.slice("parameters.".length);
			if (key.includes(".")) {
				throw new Error("Nested parameter access is not supported");
			}
			return this.#parameters[key];
		}

		throw new Error(`Unexpected token: ${next.value}`);
	}

	#accept(kind: Token["kind"]): boolean {
		if (this.#peek()?.kind !== kind) {
			return false;
		}
		this.#position += 1;
		return true;
	}

	#expect(kind: Token["kind"]): void {
		if (!this.#accept(kind)) {
			throw new Error(`Expected token ${kind}`);
		}
	}

	#peek(): Token | undefined {
		return this.#tokens[this.#position];
	}
}

function tokenize(expression: string): Array<Token> {
	const tokens: Array<Token> = [];
	let index = 0;

	while (index < expression.length) {
		const remaining = expression.slice(index);
		const whitespaceMatch = remaining.match(/^\s+/);
		if (whitespaceMatch !== null) {
			index += whitespaceMatch[0].length;
			continue;
		}

		const operator = remaining.match(/^(&&|\|\||==|!=|!|\(|\))/);
		if (operator !== null) {
			const value = operator[1];
			if (value === undefined) {
				throw new Error("Invalid operator token");
			}
			tokens.push({ kind: value as Token["kind"], value });
			index += value.length;
			continue;
		}

		const booleanLiteral = remaining.match(/^(true|false)(?![a-zA-Z0-9_])/);
		if (booleanLiteral !== null) {
			const value = booleanLiteral[1];
			if (value === undefined) {
				throw new Error("Invalid boolean token");
			}
			tokens.push({ kind: "boolean", value });
			index += value.length;
			continue;
		}

		const numberLiteral = remaining.match(/^\d+(?:\.\d+)?/);
		if (numberLiteral !== null) {
			tokens.push({ kind: "number", value: numberLiteral[0] });
			index += numberLiteral[0].length;
			continue;
		}

		const stringLiteral = remaining.match(/^"([^"\\]|\\.)*"/);
		if (stringLiteral !== null) {
			tokens.push({
				kind: "string",
				value: JSON.parse(stringLiteral[0]) as string,
			});
			index += stringLiteral[0].length;
			continue;
		}

		const identifier = remaining.match(/^[a-zA-Z_][a-zA-Z0-9_.]*/);
		if (identifier !== null) {
			tokens.push({ kind: "identifier", value: identifier[0] });
			index += identifier[0].length;
			continue;
		}

		throw new Error(`Unsupported token near: ${remaining.slice(0, 12)}`);
	}

	return tokens;
}

/**
 * Evaluates workflow step conditions without using eval().
 */
export function evaluateCondition(
	expression: string,
	parameters: Record<string, unknown>,
): boolean {
	const parser = new ConditionParser(expression, parameters);
	return parser.parse();
}
