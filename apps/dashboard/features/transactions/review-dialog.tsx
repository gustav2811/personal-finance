"use client"

import { useRef, useState, type ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { TransactionBudget } from "@/features/budget/transaction-budget"
import { demoEnabled } from "@/lib/demo/transactions"
import { Inspector, type InspectorSave } from "./inspector"
import { commandId, subject } from "./copy"
import { writeTransactionReview } from "./rpc"
import type { CategoryOption, TransactionFeedItem } from "./model"

export function TransactionReviewFrame({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode
}) {
  return <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
    <DialogContent showCloseButton={false} className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden sm:max-w-lg">
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">Category and treatment for this movement.</DialogDescription>
      {children}
    </DialogContent>
  </Dialog>
}

/** The ledger's review editor, available wherever a transaction is shown. */
export function TransactionReviewDialog({ item: initialItem, categories, onSaved, onClose, readOnly = false }: {
  item: TransactionFeedItem
  categories: CategoryOption[]
  onSaved: (item: TransactionFeedItem) => void
  onClose: () => void
  readOnly?: boolean
}) {
  const [item, setItem] = useState(initialItem)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = useRef<InspectorSave>(null)
  const closing = useRef(false)
  async function close() {
    if (closing.current) return
    closing.current = true
    try {
      if (!readOnly && save.current && !await save.current.flush()) return
      onClose()
    } finally { closing.current = false }
  }
  return <TransactionReviewFrame open title={subject(item)} onClose={() => void close()}>
      <div className="mb-2 flex shrink-0 justify-end">
        <Button aria-label="Close transaction review" onClick={() => void close()} size="icon-sm" variant="ghost"><X /></Button>
      </div>
      <Inspector categories={categories.filter((category) => category.lifecycleStatus === "active")}
        categoryError={error} item={item} saveRef={save} onDirtyChange={() => {}}
        pending={pending} readOnly={readOnly} undo={false} onUndo={() => {}} onDiscard={onClose}
        budget={demoEnabled() ? undefined : <TransactionBudget transactionId={item.id} />}
        onConfirm={async (input) => {
          if (readOnly) return "This is a local snapshot. Open the live ledger to save changes."
          setPending(true)
          setError(null)
          try {
            const result = await writeTransactionReview({
              p_transaction_id: item.id, p_category_id: input.categoryId,
              p_description: input.description, p_notes: input.notes,
              p_is_transfer: item.event ? null : input.isTransfer,
              p_exclude_from_spend: item.event ? null : input.excludeFromSpend,
              p_nature: input.nature,
              p_expected: { description: item.description, notes: item.notes ?? null, ...item.revision },
              p_review_command_id: commandId(),
            })
            if (result.conflict) throw new Error("This transaction changed elsewhere. Nothing from this save was applied. Your draft is still here.")
            setItem(result.item)
            onSaved(result.item)
            return null
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : "Changes could not be saved. Your draft is still here."
            setError(message)
            return message
          } finally { setPending(false) }
        }} />
  </TransactionReviewFrame>
}
