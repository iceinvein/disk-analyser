// TypeScript interfaces mirroring Rust types

export enum FileType {
  Document = 'Document',
  Image = 'Image',
  Video = 'Video',
  Audio = 'Audio',
  Archive = 'Archive',
  Executable = 'Executable',
  SystemFile = 'SystemFile',
  Code = 'Code',
  Other = 'Other',
}

export interface FileNode {
  name: string;
  path: string;
  size: number;
  is_directory: boolean;
  children: FileNode[];
  file_type: FileType;
  modified: number; // Unix timestamp in milliseconds
}

export interface ScanProgress {
  current_path: string;
  files_scanned: number;
  total_size: number;
}

export interface PartialScanResult {
  tree: FileNode;
  files_scanned: number;
  total_size: number;
  is_complete: boolean;
}

export interface NodeStats {
  file_count: number;
  total_size: number;
}

export type StreamingScanEvent =
  | {
      type: 'node_discovered';
      node: FileNode;
      stats: NodeStats;
      parent_path?: string;
    }
  | {
      type: 'progress';
      files_scanned: number;
      total_size: number;
      current_path: string;
    }
  | {
      type: 'complete';
      files_scanned: number;
      total_size: number;
    };

export interface CategoryStats {
  category: FileType;
  total_size: number;
  file_count: number;
}

export interface FailedDeletion {
  path: string;
  error: string;
}

export interface DeletionResult {
  deleted: string[];
  failed: FailedDeletion[];
  space_freed: number;
}

export type SafetyCheck =
  | { type: 'Safe' }
  | { type: 'Protected'; message: string }
  | { type: 'InUse'; message: string }
  | { type: 'RequiresConfirmation'; message: string };

export type SortField = 'size' | 'name' | 'type' | 'modified';
export type SortOrder = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  order: SortOrder;
}

export enum LocationType {
  Storage = 'storage',
  Network = 'network',
  Folder = 'folder',
}

export interface StorageLocation {
  name: string;
  path: string;
  location_type: LocationType;
  total_space?: number;
  available_space?: number;
}
