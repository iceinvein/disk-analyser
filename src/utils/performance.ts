/**
 * Performance monitoring utilities for profiling and optimization
 */

import { useEffect, useRef } from 'react';

interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private timers: Map<string, number> = new Map();

  /**
   * Start timing an operation
   */
  start(name: string): void {
    this.timers.set(name, performance.now());
  }

  /**
   * End timing an operation and record the metric
   */
  end(name: string): number | null {
    const startTime = this.timers.get(name);
    if (!startTime) {
      console.warn(`No start time found for metric: ${name}`);
      return null;
    }

    const duration = performance.now() - startTime;
    this.metrics.push({
      name,
      duration,
      timestamp: Date.now(),
    });

    this.timers.delete(name);

    // Log slow operations (> 100ms)
    if (duration > 100) {
      console.warn(
        `Slow operation detected: ${name} took ${duration.toFixed(2)}ms`,
      );
    }

    return duration;
  }

  /**
   * Measure a function execution time
   */
  measure<T>(name: string, fn: () => T): T {
    this.start(name);
    try {
      const result = fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * Measure an async function execution time
   */
  async measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Get metrics for a specific operation
   */
  getMetricsByName(name: string): PerformanceMetric[] {
    return this.metrics.filter((m) => m.name === name);
  }

  /**
   * Get average duration for an operation
   */
  getAverageDuration(name: string): number {
    const metrics = this.getMetricsByName(name);
    if (metrics.length === 0) return 0;

    const total = metrics.reduce((sum, m) => sum + m.duration, 0);
    return total / metrics.length;
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.timers.clear();
  }

  /**
   * Print performance summary to console
   */
  printSummary(): void {
    const grouped = new Map<string, number[]>();

    for (const metric of this.metrics) {
      if (!grouped.has(metric.name)) {
        grouped.set(metric.name, []);
      }
      const durations = grouped.get(metric.name);
      if (durations) {
        durations.push(metric.duration);
      }
    }

    console.group('Performance Summary');
    for (const [name, durations] of grouped.entries()) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      console.log(
        `${name}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms, count=${durations.length}`,
      );
    }
    console.groupEnd();
  }
}

// Global performance monitor instance
export const perfMonitor = new PerformanceMonitor();

/**
 * Decorator for measuring function performance
 */
export function measurePerformance(name?: string) {
  return (
    _target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) => {
    const originalMethod = descriptor.value;
    const metricName = name || `${String(propertyKey)}`;

    descriptor.value = function (...args: unknown[]) {
      return perfMonitor.measure(metricName, () =>
        originalMethod.apply(this, args),
      );
    };

    return descriptor;
  };
}

/**
 * Hook for measuring React component render time
 */
export function usePerformanceMonitor(componentName: string) {
  const renderCount = useRef(0);

  useEffect(() => {
    renderCount.current += 1;
    perfMonitor.end(`${componentName}-render-${renderCount.current}`);
  });

  perfMonitor.start(`${componentName}-render-${renderCount.current + 1}`);
}

/**
 * Memory usage monitoring
 */
export function logMemoryUsage(label: string): void {
  if ('memory' in performance) {
    const memory = (
      performance as Performance & {
        memory: {
          usedJSHeapSize: number;
          totalJSHeapSize: number;
          jsHeapSizeLimit: number;
        };
      }
    ).memory;
    console.log(`[Memory] ${label}:`, {
      used: `${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
      total: `${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
      limit: `${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB`,
    });
  }
}

/**
 * Debounce function for performance optimization
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function for performance optimization
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}
