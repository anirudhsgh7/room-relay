import Link from "next/link";
import { BrandMark } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-sand-50 px-5 py-12">
      <div className="surface w-full max-w-lg p-7 text-center sm:p-10">
        <div className="mb-6 flex justify-center">
          <BrandMark size="lg" tone="dark" />
        </div>
        <p className="eyebrow">404 · Not in this build</p>
        <h1 className="mt-3 font-display text-4xl leading-tight tracking-[-0.04em] text-ink-950">
          That room is not on the map.
        </h1>
        <p className="mt-4 text-sm leading-6 text-ink-600">
          The page may belong to a later RoomRelay build phase, or the address
          may be incorrect.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/app" className="btn-dark">
            Return to workspace
          </Link>
          <Link href="/" className="btn-secondary">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
