"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/primitives";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <PageHeader title="Something went wrong" description="This page could not load. Your data was not changed by this error." />
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
