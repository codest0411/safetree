declare function setTimeout(callback: (...args: any[]) => void, ms?: number): any;
declare function clearTimeout(timeoutId: any): void;

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
  interface ErrnoException extends Error {
    code?: string;
    errno?: number;
    syscall?: string;
    path?: string;
  }
  type Signals = "SIGINT" | "SIGTERM" | "SIGKILL" | string;
}

declare var process: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  platform: string;
  execPath: string;
  exitCode?: number | string;
  cwd(): string;
  exit(code?: number): never;
  once(event: string, listener: (...args: any[]) => void): any;
  stdout: { write(chunk: string | Uint8Array): boolean; isTTY?: boolean };
  stderr: { write(chunk: string | Uint8Array): boolean; isTTY?: boolean };
};

interface BufferEncoding {}

declare class Buffer extends Uint8Array {
  static from(value: string | Uint8Array | ArrayLike<number>, encoding?: string): Buffer;
  static alloc(size: number, fill?: number): Buffer;
  static allocUnsafe(size: number): Buffer;
  static concat(list: readonly Uint8Array[]): Buffer;
  static isBuffer(obj: unknown): obj is Buffer;
  toString(encoding?: string, start?: number, end?: number): string;
  indexOf(value: string | number | Uint8Array, byteOffset?: number): number;
  subarray(start?: number, end?: number): Buffer;
  copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
}

declare class URL {
  constructor(input: string, base?: string | URL);
  hostname: string;
  protocol: string;
  href: string;
}

declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module "node:path" {
  export const sep: string;
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export const posix: {
    basename(p: string, suffix?: string): string;
    extname(p: string): string;
  };
}

declare module "node:fs" {
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "node:fs/promises" {
  export interface FileHandle {
    read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
  }
  export interface Stats {
    size: number;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }
  export function mkdtemp(prefix: string): Promise<string>;
  export function realpath(p: string): Promise<string>;
  export function chmod(p: string, mode: number): Promise<void>;
  export function rm(p: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function mkdir(p: string, options?: { recursive?: boolean; mode?: number }): Promise<string | undefined>;
  export function readFile(p: string, encoding: "utf8"): Promise<string>;
  export function lstat(p: string): Promise<Stats>;
  export function open(p: string, flags: string): Promise<FileHandle>;
}

declare module "node:child_process" {
  export interface ChildProcess {
    pid?: number;
    stdin: { end(data?: string | Buffer): void };
    stdout: { on(event: "data", cb: (chunk: Buffer) => void): void };
    stderr: { on(event: "data", cb: (chunk: Buffer) => void): void };
    on(event: "error", cb: (err: NodeJS.ErrnoException) => void): void;
    on(event: "close", cb: (code: number | null) => void): void;
    kill(signal?: string): boolean;
    unref(): void;
  }
  export function spawn(
    command: string,
    args: readonly string[],
    options?: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      shell?: boolean;
      windowsHide?: boolean;
      stdio?: unknown;
    }
  ): ChildProcess;
}

declare module "node:util" {
  export interface ParseArgsOptionConfig {
    type: "string" | "boolean";
    short?: string;
    multiple?: boolean;
    default?: string | boolean;
  }
  export function parseArgs(config: {
    args?: string[];
    allowPositionals?: boolean;
    options?: Record<string, ParseArgsOptionConfig>;
  }): {
    values: Record<string, any>;
    positionals: string[];
  };
}
