"use client"

import { buttonVariants } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox"
import { cn } from "@/lib/utils"
import type { CategoryOption } from "@/lib/transactions"
import { toneClass, type DecisionNote } from "./model"

export function CategoryField({
  categories,
  name,
  note,
  onSelect,
  transactionId,
}: {
  categories: CategoryOption[]
  name: string
  note: DecisionNote
  onSelect: (category: CategoryOption) => void
  transactionId: string
}) {
  return (
    <Combobox
      items={categories}
      itemToStringLabel={(category: CategoryOption) =>
        `${category.name} ${category.group ?? ""}`
      }
      onValueChange={(category: CategoryOption | null) => {
        if (category) onSelect(category)
      }}
    >
      <ComboboxTrigger
        aria-label={
          note.text ? `${name}, ${note.text}. Change category` : `${name}. Change category`
        }
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "h-auto min-h-8 w-full max-w-56 justify-between py-1",
        )}
        data-category-for={transactionId}
      >
        <span className="flex min-w-0 flex-col items-start text-left">
          <span className="truncate">{name}</span>
          {note.text ? (
            <span className={cn("type-caption", toneClass(note.tone))}>{note.text}</span>
          ) : null}
        </span>
      </ComboboxTrigger>
      <ComboboxContent className="w-72">
        <ComboboxInput placeholder="Find a category" showTrigger={false} />
        <ComboboxEmpty>No category matches.</ComboboxEmpty>
        <ComboboxList>
          {(category: CategoryOption) => (
            <ComboboxItem key={category.id} value={category}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{category.name}</span>
                {category.group ? (
                  <span className="type-caption">{category.group}</span>
                ) : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
