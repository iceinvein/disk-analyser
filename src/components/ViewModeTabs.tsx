import { useStore } from '@nanostores/react';
import { $viewMode, setViewMode } from '../stores';
import type { ViewMode } from '../types';

interface Tab {
  id: ViewMode;
  label: string;
  icon: React.ReactNode;
}

// Icon components
const ColumnsIcon = () => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 4H5a2 2 0 00-2 2v14a2 2 0 002 2h4m0-18v18m0-18l6-2m-6 2v18m6-16a2 2 0 012 2v12a2 2 0 01-2 2m0-14V4m0 0l6 2v12l-6 2"
    />
  </svg>
);

const ListIcon = () => (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 6h16M4 10h16M4 14h16M4 18h16"
    />
  </svg>
);

const tabs: Tab[] = [
  {
    id: 'miller-columns',
    label: 'Folders',
    icon: <ColumnsIcon />,
  },
  {
    id: 'largest-files',
    label: 'Largest Files',
    icon: <ListIcon />,
  },
];

export function ViewModeTabs() {
  const viewMode = useStore($viewMode);

  const handleTabClick = (tabId: ViewMode) => {
    setViewMode(tabId);
  };

  return (
    <div
      className="flex-shrink-0 glass-strong border-b border-white/10"
      role="tablist"
      aria-label="View mode selection"
    >
      <div className="flex gap-1 px-4 py-2">
        {tabs.map((tab) => {
          const isActive = viewMode === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${tab.id}-panel`}
              onClick={() => handleTabClick(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm
                transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-purple-400/50 focus:ring-offset-2 focus:ring-offset-transparent
                ${
                  isActive
                    ? 'glass-light text-white shadow-lg shadow-purple-500/20 border-purple-400/30'
                    : 'text-gray-400 hover:text-white hover:glass-light'
                }
              `}
            >
              <span className={isActive ? 'text-purple-400' : 'text-gray-500'}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
