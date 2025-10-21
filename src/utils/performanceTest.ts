/**
 * Performance testing utilities for validating optimizations
 */

import { perfMonitor, logMemoryUsage } from './performance';
import type { FileNode } from '../types';
import { FileType } from '../types';

/**
 * Generate a mock file tree for performance testing
 */
export function generateMockFileTree(
  depth: number,
  filesPerDir: number,
  dirsPerDir: number,
  currentDepth = 0,
  pathPrefix = 'root',
): FileNode {
  const node: FileNode = {
    name: pathPrefix.split('/').pop() || 'root',
    path: pathPrefix,
    size: 0,
    is_directory: true,
    children: [],
    file_type: FileType.Other,
    modified: Date.now(),
  };

  if (currentDepth >= depth) {
    return node;
  }

  // Add files
  for (let i = 0; i < filesPerDir; i++) {
    const fileSize = Math.floor(Math.random() * 10000000); // Random size up to 10MB
    node.children.push({
      name: `file${i}.txt`,
      path: `${pathPrefix}/file${i}.txt`,
      size: fileSize,
      is_directory: false,
      children: [],
      file_type: FileType.Document,
      modified: Date.now(),
    });
    node.size += fileSize;
  }

  // Add directories
  for (let i = 0; i < dirsPerDir; i++) {
    const subDir = generateMockFileTree(
      depth,
      filesPerDir,
      dirsPerDir,
      currentDepth + 1,
      `${pathPrefix}/dir${i}`,
    );
    node.children.push(subDir);
    node.size += subDir.size;
  }

  return node;
}

/**
 * Count total nodes in a tree
 */
export function countNodes(node: FileNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}

/**
 * Test scan performance with various dataset sizes
 */
export function testScanPerformance() {
  console.group('Performance Test: Scan Operations');

  const testCases = [
    { depth: 3, filesPerDir: 10, dirsPerDir: 5, name: 'Small (1k nodes)' },
    { depth: 4, filesPerDir: 10, dirsPerDir: 5, name: 'Medium (5k nodes)' },
    { depth: 5, filesPerDir: 10, dirsPerDir: 5, name: 'Large (25k nodes)' },
    {
      depth: 5,
      filesPerDir: 20,
      dirsPerDir: 8,
      name: 'Very Large (100k+ nodes)',
    },
  ];

  for (const testCase of testCases) {
    console.log(`\nTesting ${testCase.name}...`);
    logMemoryUsage('Before generation');

    perfMonitor.start(`generate-${testCase.name}`);
    const tree = generateMockFileTree(
      testCase.depth,
      testCase.filesPerDir,
      testCase.dirsPerDir,
    );
    perfMonitor.end(`generate-${testCase.name}`);

    const nodeCount = countNodes(tree);
    console.log(`Generated ${nodeCount.toLocaleString()} nodes`);
    logMemoryUsage('After generation');

    // Test tree traversal
    perfMonitor.start(`traverse-${testCase.name}`);
    traverseTree(tree);
    perfMonitor.end(`traverse-${testCase.name}`);

    logMemoryUsage('After traversal');
  }

  perfMonitor.printSummary();
  console.groupEnd();
}

/**
 * Traverse tree (simulates processing)
 */
function traverseTree(node: FileNode): void {
  // Simulate some processing by accessing properties
  void node.size;
  void node.name;

  for (const child of node.children) {
    traverseTree(child);
  }
}

/**
 * Test filter performance
 */
export function testFilterPerformance(tree: FileNode, searchText: string) {
  console.group('Performance Test: Filter Operations');

  perfMonitor.start('filter-operation');
  const filtered = filterTree(tree, searchText);
  perfMonitor.end('filter-operation');

  const originalCount = countNodes(tree);
  const filteredCount = filtered ? countNodes(filtered) : 0;

  console.log(`Filtered ${originalCount} nodes to ${filteredCount} nodes`);
  console.log(`Search text: "${searchText}"`);

  perfMonitor.printSummary();
  console.groupEnd();
}

/**
 * Simple filter implementation for testing
 */
function filterTree(node: FileNode, searchText: string): FileNode | null {
  if (!searchText) return node;

  const lowerSearch = searchText.toLowerCase();
  const nameMatches = node.name.toLowerCase().includes(lowerSearch);

  if (node.is_directory) {
    const filteredChildren = node.children
      .map((child) => filterTree(child, searchText))
      .filter((child): child is FileNode => child !== null);

    if (nameMatches || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      };
    }
    return null;
  }

  return nameMatches ? node : null;
}

/**
 * Test sort performance
 */
export function testSortPerformance(nodes: FileNode[]) {
  console.group('Performance Test: Sort Operations');

  const sortFields = ['size', 'name', 'type', 'modified'] as const;

  for (const field of sortFields) {
    perfMonitor.start(`sort-${field}`);
    const sorted = [...nodes].sort((a, b) => {
      switch (field) {
        case 'size':
          return b.size - a.size;
        case 'name':
          return a.name.localeCompare(b.name);
        case 'type':
          return a.file_type.localeCompare(b.file_type);
        case 'modified': {
          const aTime =
            typeof a.modified === 'number'
              ? a.modified
              : a.modified.secs_since_epoch;
          const bTime =
            typeof b.modified === 'number'
              ? b.modified
              : b.modified.secs_since_epoch;
          return bTime - aTime;
        }
        default:
          return 0;
      }
    });
    perfMonitor.end(`sort-${field}`);

    console.log(`Sorted ${sorted.length} items by ${field}`);
  }

  perfMonitor.printSummary();
  console.groupEnd();
}

/**
 * Run all performance tests
 */
export function runAllPerformanceTests() {
  console.log('=== Starting Performance Tests ===\n');

  // Test scan performance
  testScanPerformance();

  // Generate a large tree for other tests
  console.log('\nGenerating test data for filter and sort tests...');
  const largeTree = generateMockFileTree(5, 10, 5);
  const nodeCount = countNodes(largeTree);
  console.log(`Generated tree with ${nodeCount.toLocaleString()} nodes\n`);

  // Test filter performance
  testFilterPerformance(largeTree, 'file');

  // Test sort performance
  const flatNodes = flattenTree(largeTree);
  testSortPerformance(flatNodes);

  console.log('\n=== Performance Tests Complete ===');
}

/**
 * Flatten tree to array
 */
function flattenTree(node: FileNode): FileNode[] {
  const result: FileNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenTree(child));
  }
  return result;
}

/**
 * Export performance data as JSON
 */
export function exportPerformanceData(): string {
  const metrics = perfMonitor.getMetrics();
  return JSON.stringify(metrics, null, 2);
}

/**
 * Benchmark a specific operation multiple times
 */
export function benchmark(
  name: string,
  operation: () => void,
  iterations = 100,
): void {
  console.group(`Benchmark: ${name} (${iterations} iterations)`);

  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    operation();
    const duration = performance.now() - start;
    durations.push(duration);
  }

  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const median = durations.sort((a, b) => a - b)[
    Math.floor(durations.length / 2)
  ];

  console.log(`Average: ${avg.toFixed(2)}ms`);
  console.log(`Median: ${median.toFixed(2)}ms`);
  console.log(`Min: ${min.toFixed(2)}ms`);
  console.log(`Max: ${max.toFixed(2)}ms`);

  console.groupEnd();
}
