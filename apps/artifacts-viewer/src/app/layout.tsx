import './global.css';

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
      <body>{children}</body>
    </html>
  );
}
