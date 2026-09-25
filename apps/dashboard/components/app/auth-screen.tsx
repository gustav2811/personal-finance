"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function AuthScreen({
  denied = false,
  error,
  onSignIn,
  signingIn,
}: {
  denied?: boolean
  error: string | null
  onSignIn: () => void
  signingIn: boolean
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="type-page-title">Household</CardTitle>
          <CardDescription>
            A private view of energy, money, and the record behind them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {denied ? (
            <Alert variant="destructive">
              <AlertTitle>This household is private.</AlertTitle>
              <AlertDescription>Use an approved household Google account.</AlertDescription>
            </Alert>
          ) : (
            <Button className="w-full" disabled={signingIn} onClick={onSignIn}>
              {signingIn ? "Opening Google…" : "Continue with Google"}
            </Button>
          )}
          {error ? (
            <p className="type-caption text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <p className="type-caption">Access is limited to household members.</p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
