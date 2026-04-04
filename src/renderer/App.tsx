export function App() {
  return (
    <div className="flex h-screen">
      <aside className="w-[220px] min-w-[220px] bg-bg flex flex-col py-2 overflow-y-auto">
        <div className="flex-1 p-3 text-fg/50">Sidebar loading...</div>
      </aside>
      <div className="w-1 cursor-col-resize bg-c0" />
      <main className="flex-1 bg-bg overflow-hidden">
        <div className="p-4 text-fg/50">Terminal loading...</div>
      </main>
    </div>
  );
}
