import { ArrowLeft, Palette } from 'lucide-react';

interface Props {
  activeSection: string;
  onSelectSection: (section: string) => void;
  onBack: () => void;
}

export function SettingsSidebar({ activeSection, onSelectSection, onBack }: Props) {
  return (
    <>
      <div className="flex items-center px-3 py-1.5 border-b border-border" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <button
          onClick={onBack}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="bg-transparent border-none text-foreground/60 hover:text-foreground cursor-pointer p-0.5 transition-colors flex items-center gap-1.5"
        >
          <ArrowLeft size={14} />
          <span className="text-sm">Settings</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <button
          onClick={() => onSelectSection('appearance')}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left bg-transparent border-none cursor-pointer transition-colors ${
            activeSection === 'appearance'
              ? 'text-foreground bg-muted'
              : 'text-foreground/60 hover:text-foreground hover:bg-muted'
          }`}
        >
          <Palette size={14} />
          Appearance
        </button>
      </div>
    </>
  );
}
