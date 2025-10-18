import { useEffect, useRef, useState, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import * as d3 from 'd3';
import { $currentView, navigateTo } from '../stores';
import type { FileNode } from '../types';
import { FileType } from '../types';

// Performance thresholds
const MAX_NODES_FULL_RENDER = 10000;
const MAX_DEPTH_LARGE_DATASET = 4;

// Color scheme from design document
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

interface ArcData {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface HierarchyNode extends d3.HierarchyRectangularNode<FileNode> {
  current?: ArcData;
  target?: ArcData;
}

/**
 * Count total nodes in tree for performance optimization
 */
function countNodes(node: FileNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countNodes(child);
  }
  return count;
}

/**
 * Prune tree to max depth for large datasets
 */
function pruneTreeByDepth(
  node: FileNode,
  maxDepth: number,
  currentDepth = 0,
): FileNode {
  if (currentDepth >= maxDepth || !node.is_directory) {
    return { ...node, children: [] };
  }

  return {
    ...node,
    children: node.children.map((child) =>
      pruneTreeByDepth(child, maxDepth, currentDepth + 1),
    ),
  };
}

export function SunburstChart() {
  const currentView = useStore($currentView);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 800 });

  // Memoize node count and optimized data
  const { nodeCount, optimizedData } = useMemo(() => {
    if (!currentView) return { nodeCount: 0, optimizedData: null };

    const count = countNodes(currentView);
    let data = currentView;

    // For large datasets, limit depth to improve performance
    if (count > MAX_NODES_FULL_RENDER) {
      console.log(
        `Large dataset detected (${count} nodes). Limiting depth to ${MAX_DEPTH_LARGE_DATASET} levels.`,
      );
      data = pruneTreeByDepth(currentView, MAX_DEPTH_LARGE_DATASET);
    }

    return { nodeCount: count, optimizedData: data };
  }, [currentView]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (svgRef.current) {
        const container = svgRef.current.parentElement;
        if (container) {
          const size = Math.min(container.clientWidth, container.clientHeight);
          setDimensions({ width: size, height: size });
        }
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!optimizedData || !svgRef.current) return;

    const { width, height } = dimensions;
    const radius = Math.min(width, height) / 2;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3
      .select(svgRef.current)
      .attr('viewBox', `${-width / 2} ${-height / 2} ${width} ${height}`)
      .style('font', '12px sans-serif');

    // Create hierarchy from optimized FileNode data
    const root = d3
      .hierarchy<FileNode>(optimizedData)
      .sum((d) => (d.is_directory ? 0 : d.size))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // Create partition layout
    const partition = d3.partition<FileNode>().size([2 * Math.PI, radius]);

    partition(root);

    // Create arc generator
    const arc = d3
      .arc<ArcData>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius / 2)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => d.y1 - 1);

    // Filter descendants for rendering (skip very small segments for performance)
    const descendants = root.descendants().filter((d) => {
      if (d.depth === 0) return false;
      // For large datasets, skip segments that are too small to see
      if (nodeCount > MAX_NODES_FULL_RENDER) {
        const totalValue = root.value || 1;
        const nodeValue = d.value || 0;
        const percentage = (nodeValue / totalValue) * 100;
        return percentage > 0.1; // Only render segments > 0.1%
      }
      return true;
    });

    // Create groups for each segment
    const g = svg.append('g').selectAll('g').data(descendants).join('g');

    // Add paths with optimized rendering
    const paths = g
      .append('path')
      .attr('fill', (d) => {
        const fileType = d.data.file_type;
        return FILE_TYPE_COLORS[fileType] || FILE_TYPE_COLORS[FileType.Other];
      })
      .attr('fill-opacity', (d) => {
        const node = d as HierarchyNode;
        return arcVisible(node.current || node) ? 0.8 : 0;
      })
      .attr('d', (d) => {
        const node = d as HierarchyNode;
        return arc(node.current || node);
      })
      .attr('role', 'button')
      .attr('aria-label', (d) => {
        const percentage = ((d.value || 0) / (root.value || 1)) * 100;
        return `${d.data.name}, ${formatSize(d.value || 0)}, ${percentage.toFixed(1)}% of total, ${d.data.file_type}${d.data.is_directory ? ', click to zoom' : ''}`;
      })
      .attr('tabindex', '0')
      .style('cursor', 'pointer');

    // Add hover effects
    paths
      .on('mouseenter', function (_event, d) {
        d3.select(this).attr('fill-opacity', 1);
        showTooltip(
          _event,
          d as unknown as d3.HierarchyRectangularNode<FileNode>,
        );
      })
      .on('mousemove', (event) => {
        moveTooltip(event);
      })
      .on('mouseleave', function (_event, d) {
        const node = d as HierarchyNode;
        d3.select(this).attr(
          'fill-opacity',
          arcVisible(node.current || node) ? 0.8 : 0,
        );
        hideTooltip();
      });

    // Add click handler for zoom
    paths.on('click', (event, d) => {
      event.stopPropagation();
      const node = d as unknown as HierarchyNode;
      if (node.data.is_directory) {
        navigateTo(node.data);
        clicked(node);
      }
    });

    // Add keyboard support for segments
    paths.on('keydown', (event, d) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        const node = d as unknown as HierarchyNode;
        if (node.data.is_directory) {
          navigateTo(node.data);
          clicked(node);
        }
      }
    });

    // Add labels (only for visible segments to improve performance)
    const labels = g
      .filter((d) => {
        const node = d as HierarchyNode;
        return labelVisible(node.current || node);
      })
      .append('text')
      .attr('pointer-events', 'none')
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .attr('fill-opacity', 1)
      .attr('transform', (d) => {
        const node = d as HierarchyNode;
        return labelTransform(node.current || node);
      })
      .style('user-select', 'none')
      .text((d) => d.data.name);

    // Add center circle for clicking back to parent
    const parent = svg
      .append('circle')
      .datum(root as HierarchyNode)
      .attr('r', radius / 8)
      .attr('fill', '#1f2937')
      .attr('pointer-events', 'all')
      .attr('role', 'button')
      .attr('aria-label', 'Navigate to parent directory')
      .attr('tabindex', '0')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        if (d.parent) {
          navigateTo(d.parent.data);
          clicked(d.parent as HierarchyNode);
        }
      })
      .on('keydown', (event, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          if (d.parent) {
            navigateTo(d.parent.data);
            clicked(d.parent as HierarchyNode);
          }
        }
      });

    // Zoom transition function
    function clicked(p: HierarchyNode) {
      parent.datum(p.parent || root);

      root.each((d) => {
        const node = d as HierarchyNode;
        node.target = {
          x0:
            Math.max(0, Math.min(1, (node.x0 - p.x0) / (p.x1 - p.x0))) *
            2 *
            Math.PI,
          x1:
            Math.max(0, Math.min(1, (node.x1 - p.x0) / (p.x1 - p.x0))) *
            2 *
            Math.PI,
          y0: Math.max(0, node.y0 - p.y0),
          y1: Math.max(0, node.y1 - p.y0),
        };
      });

      const duration = 750;

      paths
        .transition()
        .duration(duration)
        .tween('data', (d) => {
          const node = d as HierarchyNode;
          const currentData = node.current || node;
          const targetData = node.target || node;
          const i = d3.interpolate(currentData, targetData);
          return (t: number) => {
            node.current = i(t);
          };
        })
        .attr('fill-opacity', (d) => {
          const node = d as HierarchyNode;
          return arcVisible(node.target || node) ? 0.8 : 0;
        })
        .attrTween('d', (d) => {
          const node = d as HierarchyNode;
          return () => arc(node.current || node) || '';
        });

      labels
        .transition()
        .duration(duration)
        .attr('fill-opacity', (d) => {
          const node = d as HierarchyNode;
          return +labelVisible(node.target || node);
        })
        .attrTween('transform', (d) => {
          const node = d as HierarchyNode;
          return () => labelTransform(node.current || node);
        });
    }

    // Helper functions
    function arcVisible(d: ArcData) {
      return d.y1 <= radius && d.y0 >= 0 && d.x1 > d.x0;
    }

    function labelVisible(d: ArcData) {
      return (
        d.y1 <= radius &&
        d.y0 >= 0 &&
        ((d.x1 - d.x0) * (d.y1 + d.y0)) / 2 > 0.03
      );
    }

    function labelTransform(d: ArcData) {
      const x = (((d.x0 + d.x1) / 2) * 180) / Math.PI;
      const y = (d.y0 + d.y1) / 2;
      return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
    }

    function showTooltip(
      event: MouseEvent,
      d: d3.HierarchyRectangularNode<FileNode>,
    ) {
      if (!tooltipRef.current) return;

      const percentage = ((d.value || 0) / (root.value || 1)) * 100;
      const size = formatSize(d.value || 0);

      tooltipRef.current.innerHTML = `
        <div class="font-semibold">${d.data.name}</div>
        <div class="text-sm">Size: ${size}</div>
        <div class="text-sm">Percentage: ${percentage.toFixed(1)}%</div>
        <div class="text-sm text-gray-400">${d.data.file_type}</div>
      `;

      tooltipRef.current.classList.remove('opacity-0');
      tooltipRef.current.classList.add('opacity-100');
      moveTooltip(event);
    }

    function moveTooltip(event: MouseEvent) {
      if (!tooltipRef.current) return;
      const tooltip = tooltipRef.current;
      tooltip.style.left = `${event.pageX + 10}px`;
      tooltip.style.top = `${event.pageY + 10}px`;
    }

    function hideTooltip() {
      if (!tooltipRef.current) return;
      tooltipRef.current.classList.remove('opacity-100');
      tooltipRef.current.classList.add('opacity-0');
    }

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
  }, [optimizedData, dimensions, nodeCount]);

  if (!currentView) {
    return (
      <div
        className="flex items-center justify-center h-full text-gray-400"
        role="status"
      >
        <p>No data to display. Select a location to scan.</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {nodeCount > MAX_NODES_FULL_RENDER && (
        <div
          className="absolute top-4 left-4 bg-yellow-900/80 text-yellow-200 px-3 py-2 rounded-lg text-sm z-10 border border-yellow-700"
          role="alert"
          aria-live="polite"
        >
          Large dataset ({nodeCount.toLocaleString()} nodes). Showing top{' '}
          {MAX_DEPTH_LARGE_DATASET} levels for performance.
        </div>
      )}
      <svg
        ref={svgRef}
        className="w-full h-full"
        role="img"
        aria-label="Sunburst chart showing disk usage hierarchy"
      />
      <div
        ref={tooltipRef}
        role="tooltip"
        className="absolute bg-gray-800 text-white p-3 rounded-lg shadow-lg pointer-events-none z-50 border border-gray-700 opacity-0 transition-opacity"
      />
    </div>
  );
}
