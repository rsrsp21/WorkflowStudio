export {};

declare global {
  interface Window {
    workflowStudio?: {
      selectFolder: () => Promise<string | null>;
    };
  }
}
