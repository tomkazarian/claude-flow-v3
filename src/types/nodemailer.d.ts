declare module 'nodemailer' {
  interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: {
      user: string;
      pass: string;
    };
  }

  interface MailOptions {
    from?: string;
    to?: string;
    subject?: string;
    html?: string;
    text?: string;
  }

  interface SentMessageInfo {
    messageId: string;
    response: string;
  }

  interface Transporter {
    sendMail(mailOptions: MailOptions): Promise<SentMessageInfo>;
  }

  function createTransport(options: TransportOptions): Transporter;
}
