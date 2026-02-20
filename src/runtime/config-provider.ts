/**
 * Mutable runtime config holder with monotonic versioning.
 */
export class RuntimeConfigProvider<TConfig> {
	#config: TConfig;
	#version = 1;

	public constructor(initialConfig: TConfig) {
		this.#config = initialConfig;
	}

	/**
	 * Returns the latest configuration snapshot.
	 */
	public get(): TConfig {
		return this.#config;
	}

	/**
	 * Applies a new configuration and increments the snapshot version.
	 */
	public set(nextConfig: TConfig): number {
		this.#config = nextConfig;
		this.#version += 1;
		return this.#version;
	}

	/**
	 * Returns the current configuration version.
	 */
	public version(): number {
		return this.#version;
	}
}
