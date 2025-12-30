export interface FileNode {
  name: string;
  path: string;
  isFolder: boolean;
  children?: FileNode[];
  content?: Uint8Array; // Raw bytes
}

export enum EditorMode {
  SOURCE = 'SOURCE',
}

export interface AppSettings {
  pythonPath: string;
  autoEscapeUnicode: boolean;
}