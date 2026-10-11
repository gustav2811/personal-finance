export type MemberRef = {
  id: string
  email: string | null
}

export function spokenName(email: string | null | undefined): string {
  const local = email?.split("@")[0]?.split(/[._-]/)[0]?.trim()
  if (!local) return "A household member"
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase()
}

export function memberName(members: readonly MemberRef[], id: string | null | undefined): string | null {
  if (!id) return null
  const member = members.find((entry) => entry.id === id)
  if (!member) return "A household member"
  return spokenName(member.email)
}
