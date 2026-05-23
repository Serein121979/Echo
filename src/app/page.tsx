import Link from "next/link";
import { EchoApp } from "@/components/echo/EchoApp";

export default function Page() {
  return (
    <main className="relative min-h-screen">
      <Link
        href="/clips"
        className="absolute top-4 right-4 z-20 rounded-full border border-neutral-300 bg-white/90 px-4 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur transition hover:border-neutral-900 hover:text-neutral-950"
      >
        Clips
      </Link>
      <EchoApp />
    </main>
  );
}
