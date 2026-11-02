export default function AppLoading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="h-6 w-48 animate-pulse rounded bg-surface-raised" />
      <div className="mt-4 h-40 animate-pulse rounded bg-surface-raised" />
    </div>
  );
}
