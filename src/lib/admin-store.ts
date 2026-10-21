"use client"

import { create } from "zustand"

/* ============================================================
 *  Hidden admin area — client state.
 *  `open` drives the dialog; `authed` mirrors the session.
 *  The dialog is opened by clicking the ELMINYAWE MEDIA STUDIO
 *  mark in the footer.
 *
 *  Session transport (dual-channel):
 *    - httpOnly cookie (classic same-origin) — set by the server
 *    - `x-elminyawe-admin` header — token kept in sessionStorage,
 *      sent by authFetch() on every admin request.
 *
 *  Why the header: preview panels / embedded iframes block
 *  SameSite=Lax cookies, which made login appear to succeed and
 *  then instantly bounce the owner back out (401 on the first
 *  follow-up request). The header works in every context.
 * ============================================================ */

const TOKEN_KEY = "elminyawe.admin.token"

export function readAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveAdminToken(token: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* storage unavailable — cookie channel may still work */
  }
}

export function clearAdminToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/** fetch() wrapper that always attaches the admin session token. */
export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = readAdminToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set("x-elminyawe-admin", token)
  return fetch(input, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  })
}

interface AdminState {
  open: boolean
  authed: boolean | null
  setOpen: (open: boolean) => void
  openPanel: () => void
  closePanel: () => void
  setAuthed: (authed: boolean) => void
  refresh: () => Promise<void>
}

export const useAdminStore = create<AdminState>((set) => ({
  open: false,
  authed: null,
  setOpen: (open) => set({ open }),
  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  setAuthed: (authed) => set({ authed }),
  refresh: async () => {
    try {
      const res = await authFetch("/api/admin/auth")
      const data = (await res.json()) as { authed?: boolean }
      if (!data.authed) clearAdminToken()
      set({ authed: !!data.authed })
    } catch {
      set({ authed: false })
    }
  },
}))
