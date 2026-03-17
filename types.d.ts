type Buffer = any;

declare const process: {
  env: Record<string, string | undefined>;
};

declare module '*.css';

declare module 'react' {
  export const StrictMode: any;
  export const startTransition: (scope: () => void) => void;
  export const useState: <T>(initialState: T | (() => T)) => [T, (value: T | ((current: T) => T)) => void];
}

declare module 'react/jsx-runtime' {
  export const Fragment: any;
  export const jsx: any;
  export const jsxs: any;
}

declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment): {
    render(children: any): void;
  };
}

declare module 'express' {
  const express: any;
  export default express;
}

declare module 'multer' {
  const multer: any;
  export default multer;
}

declare module 'gifencoder' {
  const GIFEncoder: any;
  export default GIFEncoder;
}

declare module 'node:fs' {
  export const createWriteStream: any;
  export const existsSync: any;
}

declare module 'node:fs/promises' {
  export const mkdir: any;
  export const readFile: any;
}

declare module 'node:path' {
  const path: any;
  export default path;
}

declare module 'node:crypto' {
  export const randomUUID: () => string;
}

declare module 'node:url' {
  export const fileURLToPath: (value: string | URL) => string;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}
