declare global {
  interface Window {
    business?: {
      request: (
        payload: any,
      ) => Promise<{ ok: boolean; data?: any; error?: string }>;
    };
  }
}

export {};
