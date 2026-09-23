export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-app overflow-hidden flex items-center justify-center px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-40 h-[560px] w-[560px] rounded-full opacity-25 blur-3xl"
        style={{ backgroundImage: 'var(--accent-gradient)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -left-40 h-[480px] w-[480px] rounded-full opacity-15 blur-3xl"
        style={{ backgroundImage: 'var(--accent-gradient)' }}
      />
      <div className="relative z-10 w-full flex items-center justify-center">{children}</div>
    </div>
  );
}
