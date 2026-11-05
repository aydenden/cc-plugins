export type GuardBand = { paused: boolean };

declare module 'claude-code' {
  interface PluginState {
    'long-run': { band: GuardBand | null; pushes: number };
  }
}
