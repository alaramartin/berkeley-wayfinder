import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FIELD_ENABLED } from "@/lib/field/gate";
import { FieldApp } from "@/components/field/FieldApp";

export const metadata: Metadata = { title: "Field", robots: { index: false, follow: false } };

/** The walk's tool exists only in builds made for the walk. The public site is built without it. */
export default function FieldPage() {
  if (!FIELD_ENABLED) notFound();
  return <FieldApp />;
}
