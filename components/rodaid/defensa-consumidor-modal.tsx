'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FooterDefensaConsumidor } from './FooterDefensaConsumidor'

export function DefensaConsumidorModal() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="transition-colors hover:text-lime"
      >
        Defensa al consumidor
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl rounded-2xl border-0 bg-paper p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Centro de Transparencia y Reclamos</DialogTitle>
          </DialogHeader>
          <FooterDefensaConsumidor
            onAbrirTicket={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
