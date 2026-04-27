import { AppearanceSettings } from './AppearanceSettings';
import { DefaultTabsSettings } from './DefaultTabsSettings';
import { RemoteHostPanel } from './RemoteHostPanel';

interface Props {
  section: string;
}

export function SettingsView({ section }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {section === 'appearance' && <AppearanceSettings />}
      {section === 'default-tabs' && <DefaultTabsSettings />}
      {section === 'remote' && <RemoteHostPanel />}
    </div>
  );
}
