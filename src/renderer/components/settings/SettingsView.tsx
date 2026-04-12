import { AppearanceSettings } from './AppearanceSettings';

interface Props {
  section: string;
}

export function SettingsView({ section }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {section === 'appearance' && <AppearanceSettings />}
    </div>
  );
}
