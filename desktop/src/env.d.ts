declare global {
  interface Window {
    api?: {
      loadParams(): Promise<unknown>;
      saveParams(params: unknown): Promise<boolean>;
      resetParams(): Promise<unknown>;
      openExternal(url: string): Promise<void>;
    };
  }
}

export {};
