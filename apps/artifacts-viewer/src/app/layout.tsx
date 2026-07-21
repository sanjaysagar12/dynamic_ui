import './global.css';
import { SupabaseSessionProvider } from '../lib/supabase/supabase-session-context';

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
        <SupabaseSessionProvider>{children}</SupabaseSessionProvider>
      </body>
    </html>
  );
}
