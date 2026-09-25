import { notFound } from "next/navigation"
import { UiGallery } from "./ui-gallery"

export const dynamic = "force-dynamic"

export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <UiGallery />
}
