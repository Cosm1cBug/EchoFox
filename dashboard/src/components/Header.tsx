interface HeaderProps {
  onLogout: () => void;
}

export function Header({ onLogout }: HeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-3 border-b border-white/5 pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          EchoFox Dashboard
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
          <span className="bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            EchoFox
          </span>
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onLogout}
          className="rounded-md border border-white/10 px-3 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-white"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
```