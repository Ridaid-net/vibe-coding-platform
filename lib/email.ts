import nodemailer from 'nodemailer'

export function getMailer() {
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.ZOHO_SMTP_USER,
      pass: process.env.ZOHO_SMTP_PASS,
    },
  })
}

export async function enviarEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  const mailer = getMailer()
  return mailer.sendMail({
    from: `RODAID <${process.env.ZOHO_SMTP_USER}>`,
    to,
    subject,
    html,
  })
}
