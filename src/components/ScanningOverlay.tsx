import { useStore } from '@nanostores/react';
import { $scanProgress, $scanTarget, cancelScan } from '../stores';
import { FileText, HardDrive, Clock } from 'lucide-react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, useState } from 'react';

// Witty messages that cycle during scanning
const WITTY_MESSAGES = [
  'Counting all the bits and bytes...',
  'Teaching electrons to organize themselves...',
  'Asking your files nicely to line up...',
  'Calculating the meaning of disk space...',
  'Herding digital cats into folders...',
  'Convincing your SSD to share its secrets...',
  'Performing advanced folder archaeology...',
  'Negotiating with stubborn directories...',
  'Measuring the weight of your data...',
  'Translating binary into human-readable stats...',
  'Untangling the web of nested folders...',
  'Interrogating suspicious file sizes...',
  'Summoning the disk usage spirits...',
  'Decoding the matrix of your filesystem...',
  'Politely asking files about their size...',
];

// Helper to get random delay in a range
const randomDelay = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Typewriter component with cursor
function TypewriterText({ messages }: { messages: string[] }) {
  const [displayText, setDisplayText] = useState('');
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [phase, setPhase] = useState<
    'blank' | 'typing' | 'pause' | 'backspace'
  >('blank');
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const currentMessage = messages[currentMessageIndex];

    if (phase === 'blank' && displayText === '') {
      // Phase 1: Blank cursor blinking (800ms - 1500ms)
      timeout = setTimeout(
        () => {
          setPhase('typing');
        },
        randomDelay(800, 1500),
      );
    } else if (
      phase === 'typing' &&
      displayText.length < currentMessage.length
    ) {
      // Phase 2: Typing characters (40ms - 80ms per character for natural feel)
      timeout = setTimeout(
        () => {
          setDisplayText(currentMessage.slice(0, displayText.length + 1));
        },
        randomDelay(40, 80),
      );
    } else if (phase === 'typing' && displayText === currentMessage) {
      // Phase 3: Pause with full message (1500ms - 2500ms)
      timeout = setTimeout(
        () => {
          setPhase('pause');
        },
        randomDelay(1500, 2500),
      );
    } else if (phase === 'pause') {
      // Start backspacing
      setPhase('backspace');
    } else if (phase === 'backspace' && displayText.length > 0) {
      // Phase 4: Backspacing (20ms - 40ms per character - faster than typing)
      timeout = setTimeout(
        () => {
          setDisplayText(displayText.slice(0, -1));
        },
        randomDelay(20, 60),
      );
    } else if (phase === 'backspace' && displayText === '') {
      // Phase 5: Move to next message after backspace complete (400ms - 800ms gap)
      timeout = setTimeout(
        () => {
          setCurrentMessageIndex((prev) => (prev + 1) % messages.length);
          setPhase('blank');
        },
        randomDelay(400, 1200),
      );
    }

    return () => clearTimeout(timeout);
  }, [displayText, currentMessageIndex, phase, messages]);

  // Cursor blinking effect
  useEffect(() => {
    const interval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-sm text-gray-400 italic font-mono">
      {displayText}
      <span
        className={`inline-block w-0.5 h-4 bg-gray-400 ml-0.5 ${showCursor ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

// Format bytes to human-readable size
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

// Format number with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}

// Animated counter component
function AnimatedCounter({
  value,
  label,
  icon: Icon,
  formatValue,
}: {
  value: number;
  label: string;
  icon: React.ElementType;
  formatValue?: (val: number) => string;
}) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => {
    const roundedValue = Math.round(latest);
    return formatValue ? formatValue(roundedValue) : formatNumber(roundedValue);
  });

  useEffect(() => {
    const controls = animate(count, value, { duration: 0.5 });
    return () => controls.stop();
  }, [value, count]);

  return (
    <div className="glass-light rounded-2xl p-6 flex items-center gap-4 min-w-[200px]">
      <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20">
        <Icon className="w-6 h-6 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <motion.div className="text-2xl font-bold text-white tabular-nums">
          {rounded}
        </motion.div>
        <div className="text-sm text-gray-400">{label}</div>
      </div>
    </div>
  );
}

export function ScanningOverlay() {
  const scanProgress = useStore($scanProgress);
  const scanTarget = useStore($scanTarget);

  // Time tracking
  const [startTime] = useState(Date.now());
  const [elapsedTime, setElapsedTime] = useState(0);

  // Recent paths (terminal-like scrolling)
  const [recentPaths, setRecentPaths] = useState<string[]>([]);

  // Update elapsed time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  // Update recent paths when current path changes
  useEffect(() => {
    const currentPath = scanProgress?.current_path;
    if (currentPath) {
      setRecentPaths((prev) => {
        const newPaths = [
          currentPath,
          ...prev.filter((p) => p !== currentPath),
        ];
        return newPaths.slice(0, 5); // Keep only last 5
      });
    }
  }, [scanProgress?.current_path]);

  const handleCancel = async () => {
    await cancelScan();
  };

  const filesScanned = scanProgress?.files_scanned || 0;
  const totalSize = scanProgress?.total_size || 0;

  // Extract folder name from path
  const folderName = scanTarget?.split('/').pop() || 'Everything';

  // Format elapsed time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-strong rounded-3xl p-8 max-w-3xl w-full mx-4 shadow-2xl border border-white/10">
        {/* Header with Cancel Button */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">
            Scanning {folderName}
          </h2>
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-150 text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span className="font-medium text-sm">Cancel</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <AnimatedCounter
            value={filesScanned}
            label="Items Found"
            icon={FileText}
          />
          <AnimatedCounter
            value={totalSize}
            label="Total Size"
            icon={HardDrive}
            formatValue={formatSize}
          />
        </div>

        {/* Terminal-like Scrolling Area */}
        <div className="glass-light rounded-xl p-4 mb-6 h-40 overflow-hidden">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <span className="text-xs text-gray-400 font-mono">scan.log</span>
          </div>
          <div className="space-y-1 font-mono text-xs">
            {recentPaths.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-gray-500"
              >
                <span className="text-green-400">$</span> Initializing scan...
              </motion.div>
            ) : (
              recentPaths.map((path, index) => (
                <div
                  key={path}
                  className="flex items-start gap-2 text-gray-300"
                  style={{ opacity: 1 - index * 0.2 }}
                >
                  <span className="text-green-400 flex-shrink-0">›</span>
                  <span className="truncate">{path}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Animated Progress Bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <TypewriterText messages={WITTY_MESSAGES} />
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Clock className="w-4 h-4" />
              <span className="tabular-nums">{formatTime(elapsedTime)}</span>
            </div>
          </div>
          <div className="relative h-2 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
              animate={{
                backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: 'linear',
              }}
              style={{
                backgroundSize: '200% 100%',
              }}
            >
              <div className="h-full w-full bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
