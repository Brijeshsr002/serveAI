"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <button className="text-sm text-primary underline" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
