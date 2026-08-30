declare global {
  interface Window {
    api?: {
      loadParams(regionKey: string): Promise<unknown>;
      saveParams(regionKey: string, params: unknown): Promise<boolean>;
      resetParams(regionKey: string): Promise<unknown>;
      openExternal(url: string): Promise<void>;
      fetchRemote(url: string): Promise<string>;
      pickJsonFile(): Promise<string | null>;
      saveJsonFile(content: string, defaultName: string): Promise<boolean>;
    };
  }
}

export {};
