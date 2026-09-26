import { LoginScreen } from "@/components/shell/login-screen"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  const error = params.error === "auth" ? "Google sign-in could not finish." : null
  return <LoginScreen error={error} />
}
