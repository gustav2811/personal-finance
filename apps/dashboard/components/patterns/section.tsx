import type { ReactNode } from "react"

export function Section({
  children,
  description,
  title,
}: {
  children?: ReactNode
  description?: string
  title: string
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="type-section-title">{title}</h2>
        {description ? (
          <p className="type-body-small max-w-3xl text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}
