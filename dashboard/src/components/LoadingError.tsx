export function Loading() {
  return <div className="py-10 text-center text-slate-400">Loading...</div>;
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-6 text-rose-300">
      {message}
    </div>
  );
}
```