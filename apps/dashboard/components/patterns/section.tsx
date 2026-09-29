import type { ReactNode } from "react"

export function Section({
  actions,
  children,
  description,
  title,
}: {
  actions?: ReactNode
  children?: ReactNode
  description?: string
  title: string
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h2 className="type-section-title">{title}</h2>
          {description ? (
            <p className="type-body-small max-w-3xl text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
