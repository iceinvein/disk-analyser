import { useMemo, memo, useCallback, useId } from 'react';
import { useStore } from '@nanostores/react';
import { Card, CardBody } from '@heroui/react';
import { $scanResult, setFilterText } from '../stores';
import { FileType, type CategoryStats as CategoryStatsType } from '../types';

// Color scheme matching SunburstChart
const FILE_TYPE_COLORS: Record<FileType, string> = {
  [FileType.Document]: '#3B82F6',
  [FileType.Image]: '#10B981',
  [FileType.Video]: '#8B5CF6',
  [FileType.Audio]: '#F59E0B',
  [FileType.Archive]: '#F97316',
  [FileType.Executable]: '#EF4444',
  [FileType.SystemFile]: '#6B7280',
  [FileType.Code]: '#06B6D4',
  [FileType.Other]: '#9CA3AF',
};

// Icon mapping for file types
const FILE_TYPE_ICONS: Record<FileType, string> = {
  [FileType.Document]: '📄',
  [FileType.Image]: '🖼️',
  [FileType.Video]: '🎬',
  [FileType.Audio]: '🎵',
  [FileType.Archive]: '📦',
  [FileType.Executable]: '⚙️',
  [FileType.SystemFile]: '🔧',
  [FileType.Code]: '💻',
  [FileType.Other]: '📁',
};

/**
 * Computes category statistics from a FileNode tree
 */
function computeCategoryStats(
  node: import('../types').FileNode,
  statsMap: Map<FileType, { totalSize: number; fileCount: number }>,
): void {
  if (!node.is_directory) {
    // For files, add to the stats
    const existing = statsMap.get(node.file_type) || {
      totalSize: 0,
      fileCount: 0,
    };
    statsMap.set(node.file_type, {
      totalSize: existing.totalSize + node.size,
      fileCount: existing.fileCount + 1,
    });
  }

  // Recursively process children
  for (const child of node.children) {
    computeCategoryStats(child, statsMap);
  }
}

/**
 * Formats bytes into human-readable format
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Memoized CategoryStatsCard component to prevent unnecessary re-renders
const CategoryStatsCard = memo(function CategoryStatsCard({
  stat,
  totalSize,
  onCategoryClick,
}: {
  stat: CategoryStatsType;
  totalSize: number;
  onCategoryClick: (category: FileType) => void;
}) {
  const percentage = totalSize > 0 ? (stat.total_size / totalSize) * 100 : 0;
  const color = FILE_TYPE_COLORS[stat.category];
  const icon = FILE_TYPE_ICONS[stat.category];

  return (
    <Card
      key={stat.category}
      isPressable
      onPress={() => onCategoryClick(stat.category)}
      className="bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
      role="listitem"
    >
      <CardBody className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-2xl" aria-hidden="true">
              {icon}
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-white truncate">
                {stat.category}
              </h3>
              <p className="text-sm text-gray-400">
                {stat.file_count} {stat.file_count === 1 ? 'file' : 'files'}
              </p>
            </div>
          </div>
          <div
            className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
            style={{ backgroundColor: color }}
            aria-label={`Color indicator for ${stat.category}`}
          />
        </div>
        <div className="mt-3 space-y-1">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-semibold text-white">
              {formatSize(stat.total_size)}
            </span>
            <span className="text-sm text-gray-400">
              {percentage.toFixed(1)}%
            </span>
          </div>
          <div
            className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(percentage)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${stat.category} usage: ${percentage.toFixed(1)}%`}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                backgroundColor: color,
                width: `${percentage}%`,
              }}
            />
          </div>
        </div>
      </CardBody>
    </Card>
  );
});

export function CategoryStats() {
  const scanResult = useStore($scanResult);
  const headingId = useId();

  // Compute category statistics from scan result with memoization
  const categoryStats = useMemo<CategoryStatsType[]>(() => {
    if (!scanResult) return [];

    const statsMap = new Map<
      FileType,
      { totalSize: number; fileCount: number }
    >();
    computeCategoryStats(scanResult, statsMap);

    // Convert to array and sort by total size (descending)
    return Array.from(statsMap.entries())
      .map(([category, { totalSize, fileCount }]) => ({
        category,
        total_size: totalSize,
        file_count: fileCount,
      }))
      .sort((a, b) => b.total_size - a.total_size);
  }, [scanResult]);

  // Calculate total size for percentage calculation with memoization
  const totalSize = useMemo(
    () => categoryStats.reduce((sum, stat) => sum + stat.total_size, 0),
    [categoryStats],
  );

  // Memoize category click handler
  const handleCategoryClick = useCallback((category: FileType) => {
    setFilterText(category);
  }, []);

  if (!scanResult || categoryStats.length === 0) {
    return (
      <div className="p-4 text-gray-400 text-center" role="status">
        <p>
          No category data available. Scan a location to see file type
          breakdown.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-semibold text-white mb-4" id={headingId}>
        File Categories
      </h2>
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
        role="list"
        aria-labelledby={headingId}
      >
        {categoryStats.map((stat) => (
          <CategoryStatsCard
            key={stat.category}
            stat={stat}
            totalSize={totalSize}
            onCategoryClick={handleCategoryClick}
          />
        ))}
      </div>
    </div>
  );
}
