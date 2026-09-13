import './global.css';
import { SessionProvider } from '../lib/session/session-context';

export const metadata = {
  title: 'Artifacts Viewer',
  description: 'Renders artifacts from the Artifacts Server in a sandboxed iframe.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
